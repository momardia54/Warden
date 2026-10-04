import { generateLicenseKey, isStatus, normalizeDomain, parseDomains, type Status } from "../lib/license"
import { deleteLicenseFiles } from "./files.server"
import { newId } from "./util.server"

export type License = {
  id: string
  name: string
  client: string
  license_key: string
  status: Status
  expires_at: number | null
  domains: string
  message: string
  notes: string
  created_at: number
  updated_at: number
  last_check_at: number | null
  last_check_domain: string | null
  check_count: number
  external_ref: string | null
}

export type Activity = { id: number; at: number; kind: "check" | "change" | "download"; status: string | null; domain: string | null; detail: string }

export type LicenseInput = {
  name: string
  client: string
  status: Status
  expires_at: number | null
  domains: string
  message: string
  notes: string
  external_ref?: string | null
}

/** Validates form fields. Returns the cleaned input or an error message. */
export function readLicenseForm(form: FormData): { input: LicenseInput } | { error: string } {
  const name = String(form.get("name") ?? "").trim()
  if (!name) return { error: "Give the licence a name." }
  if (name.length > 120) return { error: "The name is too long (120 characters max)." }
  const status = String(form.get("status") ?? "active")
  if (!isStatus(status)) return { error: "Unknown status." }

  const expiresRaw = String(form.get("expires_at") ?? "").trim()
  let expires_at: number | null = null
  if (expiresRaw) {
    // A date picker value (YYYY-MM-DD). The licence runs through the end of that day, UTC.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw)) return { error: "Enter the end date as YYYY-MM-DD." }
    expires_at = Date.parse(`${expiresRaw}T23:59:59.999Z`)
    if (Number.isNaN(expires_at)) return { error: "That end date does not exist." }
  }

  const domainText = String(form.get("domains") ?? "")
  const bad = domainText.split(/[\s,]+/).filter(Boolean).find((d) => !normalizeDomain(d))
  if (bad) return { error: `"${bad}" is not a valid domain.` }

  return {
    input: {
      name,
      client: String(form.get("client") ?? "").trim().slice(0, 120),
      status,
      expires_at,
      domains: parseDomains(domainText).join(", "),
      message: String(form.get("message") ?? "").trim().slice(0, 300),
      notes: String(form.get("notes") ?? "").trim().slice(0, 4000),
    },
  }
}

export async function createLicense(env: Env, input: LicenseInput): Promise<License> {
  const now = Date.now()
  const id = newId("lic")
  const key = generateLicenseKey()
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO licenses (id, name, client, license_key, status, expires_at, domains, message, notes, external_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, input.name, input.client, key, input.status, input.expires_at, input.domains, input.message, input.notes, input.external_ref ?? null, now, now),
    logChange(env, id, now, input.status, "Licence created"),
  ])
  return (await getLicense(env, id))!
}

export function getLicense(env: Env, id: string): Promise<License | null> {
  return env.DB.prepare("SELECT * FROM licenses WHERE id = ?").bind(id).first<License>()
}

export function getLicenseByRef(env: Env, ref: string): Promise<License | null> {
  return env.DB.prepare("SELECT * FROM licenses WHERE external_ref = ?").bind(ref).first<License>()
}

export async function listLicenses(env: Env): Promise<License[]> {
  const res = await env.DB.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all<License>()
  return res.results
}

function logChange(env: Env, id: string, at: number, status: string | null, detail: string) {
  return env.DB.prepare("INSERT INTO activity (license_id, at, kind, status, detail) VALUES (?, ?, 'change', ?, ?)").bind(id, at, status, detail)
}

export async function updateLicense(env: Env, before: License, input: LicenseInput): Promise<void> {
  const now = Date.now()
  const changes: string[] = []
  if (before.status !== input.status) changes.push(`Status ${before.status} -> ${input.status}`)
  if (before.expires_at !== input.expires_at) changes.push(`End date ${fmt(before.expires_at)} -> ${fmt(input.expires_at)}`)
  if (before.domains !== input.domains) changes.push("Domains changed")
  if (before.message !== input.message) changes.push("Message changed")
  if (before.name !== input.name || before.client !== input.client || before.notes !== input.notes) changes.push("Details edited")
  const statements = [
    env.DB.prepare("UPDATE licenses SET name = ?, client = ?, status = ?, expires_at = ?, domains = ?, message = ?, notes = ?, updated_at = ? WHERE id = ?").bind(
      input.name, input.client, input.status, input.expires_at, input.domains, input.message, input.notes, now, before.id
    ),
  ]
  if (changes.length) statements.push(logChange(env, before.id, now, input.status, changes.join("; ")))
  await env.DB.batch(statements)
}

function fmt(ts: number | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "none"
}

export async function setStatus(env: Env, license: License, status: Status): Promise<void> {
  if (license.status === status) return
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, license.id),
    logChange(env, license.id, now, status, `Status ${license.status} -> ${status}`),
  ])
}

/** Moves the end date forward by `days`, counting from today when the licence has already ended. Re-activates an expired licence. */
export async function extendLicense(env: Env, license: License, days: number): Promise<void> {
  const now = Date.now()
  const from = license.expires_at && license.expires_at > now ? license.expires_at : now
  const to = from + days * 86_400_000
  const status: Status = license.status === "expired" ? "active" : license.status
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?").bind(to, status, now, license.id),
    logChange(env, license.id, now, status, `Extended ${days} days, now ends ${fmt(to)}`),
  ])
}

/** Sets the end date to `until` and brings an expired licence back to active. Other statuses stay as they are. */
export async function renewUntil(env: Env, license: License, until: number): Promise<void> {
  const now = Date.now()
  const status: Status = license.status === "expired" ? "active" : license.status
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?").bind(until, status, now, license.id),
    logChange(env, license.id, now, status, `Renewed, now ends ${fmt(until)}`),
  ])
}

export async function regenerateKey(env: Env, license: License): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET license_key = ?, updated_at = ? WHERE id = ?").bind(generateLicenseKey(), now, license.id),
    logChange(env, license.id, now, license.status, "Key regenerated, the old key and check URL no longer work"),
  ])
}

export async function deleteLicense(env: Env, id: string): Promise<void> {
  await deleteLicenseFiles(env, id)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM files WHERE license_id = ?").bind(id),
    env.DB.prepare("DELETE FROM activity WHERE license_id = ?").bind(id),
    env.DB.prepare("DELETE FROM licenses WHERE id = ?").bind(id),
  ])
}

export async function recentActivity(env: Env, id: string, limit = 50): Promise<Activity[]> {
  const res = await env.DB.prepare("SELECT id, at, kind, status, domain, detail FROM activity WHERE license_id = ? ORDER BY at DESC, id DESC LIMIT ?").bind(id, limit).all<Activity>()
  return res.results
}

export async function overviewStats(env: Env, now = Date.now()) {
  const soon = now + 14 * 86_400_000
  const rows = await env.DB.prepare("SELECT status, expires_at, last_check_at, created_at FROM licenses").all<Pick<License, "status" | "expires_at" | "last_check_at" | "created_at">>()
  const counts = { pending: 0, active: 0, completed: 0, suspended: 0, disabled: 0, expired: 0 }
  let endingSoon = 0
  let silent = 0
  for (const r of rows.results) {
    const effective = r.status === "active" && r.expires_at !== null && r.expires_at <= now ? "expired" : r.status
    if (effective in counts) counts[effective as keyof typeof counts]++
    if (effective === "active" && r.expires_at !== null && r.expires_at <= soon) endingSoon++
    // An active licence nobody has checked for 3 days: the site may not be calling it.
    if (effective === "active" && now - (r.last_check_at ?? r.created_at) > 3 * 86_400_000) silent++
  }
  return { total: rows.results.length, counts, endingSoon, silent }
}

export async function recentChecks(env: Env, limit = 10) {
  const res = await env.DB.prepare(
    "SELECT a.at, a.status, a.domain, l.id AS license_id, l.name FROM activity a JOIN licenses l ON l.id = a.license_id WHERE a.kind = 'check' ORDER BY a.at DESC, a.id DESC LIMIT ?"
  ).bind(limit).all<{ at: number; status: string; domain: string | null; license_id: string; name: string }>()
  return res.results
}

export const CHECK_RETENTION_DAYS = 90

export async function pruneActivity(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM activity WHERE kind = 'check' AND at < ?").bind(now - CHECK_RETENTION_DAYS * 86_400_000).run()
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(now - 86_400_000).run()
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run()
}
