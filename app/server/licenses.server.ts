import { generateLicenseKey, isStatus, normalizeDomain, parseDomains, type Status } from "../lib/license"
import { deleteLicenseFiles } from "./files.server"
import { newId } from "./util.server"

export type License = {
  id: string
  name: string
  customer_name: string
  customer_email: string
  license_key: string
  status: Status
  expires_at: number | null
  domains: string
  /** Maximum number of distinct sites (domains) the licence may be used on. Null means unlimited. */
  max_sites: number | null
  message: string
  notes: string
  app_id: string | null
  created_at: number
  updated_at: number
  last_check_at: number | null
  last_check_domain: string | null
  check_count: number
  external_ref: string | null
  /** Joined from the app, when the licence belongs to one. */
  app_slug?: string | null
  app_name?: string | null
  /** Number of sites the licence has been used on. */
  sites_used?: number
}

export type Activity = { id: number; at: number; event: "check" | "change" | "download"; status: string | null; domain: string | null; detail: string }

export type Activation = { domain: string; first_seen_at: number; last_seen_at: number; check_count: number }

export type LicenseInput = {
  name: string
  customer_name: string
  customer_email: string
  app_id: string | null
  max_sites: number | null
  status: Status
  expires_at: number | null
  domains: string
  message: string
  notes: string
  external_ref?: string | null
}

export const MAX_SITES_LIMIT = 100_000

/** Parses an optional positive whole number. Empty input means "no value" (null). Returns "invalid" for anything else. */
export function parseOptionalCount(raw: unknown, max = MAX_SITES_LIMIT): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null
  const n = typeof raw === "number" ? raw : Number(String(raw).trim())
  return Number.isInteger(n) && n >= 1 && n <= max ? n : "invalid"
}

export function validEmail(value: string): boolean {
  return value === "" || (value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
}

/** Validates the dashboard form and returns the cleaned input, or an error message. */
export function readLicenseForm(form: FormData): { input: LicenseInput } | { error: string } {
  const name = String(form.get("name") ?? "").trim()
  if (!name) return { error: "Enter a name for the licence." }
  if (name.length > 120) return { error: "The name must be 120 characters or fewer." }
  const status = String(form.get("status") ?? "active")
  if (!isStatus(status)) return { error: "Unknown status." }

  const expiresRaw = String(form.get("expires_at") ?? "").trim()
  let expires_at: number | null = null
  if (expiresRaw) {
    // The date picker submits YYYY-MM-DD. The licence stays valid through the end of that day (UTC).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw)) return { error: "Enter the expiry date as YYYY-MM-DD." }
    expires_at = Date.parse(`${expiresRaw}T23:59:59.999Z`)
    if (Number.isNaN(expires_at)) return { error: "That expiry date is not a valid date." }
  }

  const domainText = String(form.get("domains") ?? "")
  const invalidDomain = domainText.split(/[\s,]+/).filter(Boolean).find((d) => !normalizeDomain(d))
  if (invalidDomain) return { error: `"${invalidDomain}" is not a valid domain.` }

  const maxSites = parseOptionalCount(form.get("max_sites"))
  if (maxSites === "invalid") return { error: "Maximum sites must be a whole number of 1 or more, or empty for unlimited." }

  const customerEmail = String(form.get("customer_email") ?? "").trim()
  if (!validEmail(customerEmail)) return { error: "Enter a valid customer email address." }

  return {
    input: {
      name,
      customer_name: String(form.get("customer_name") ?? "").trim().slice(0, 120),
      customer_email: customerEmail,
      app_id: String(form.get("app_id") ?? "").trim() || null,
      max_sites: maxSites,
      status,
      expires_at,
      domains: parseDomains(domainText).join(", "),
      message: String(form.get("message") ?? "").trim().slice(0, 300),
      notes: String(form.get("notes") ?? "").trim().slice(0, 4000),
    },
  }
}

const SELECT_LICENSES = `SELECT l.*, a.slug AS app_slug, a.name AS app_name,
  (SELECT COUNT(*) FROM activations x WHERE x.license_id = l.id) AS sites_used
  FROM licenses l LEFT JOIN apps a ON a.id = l.app_id`

export async function createLicense(env: Env, input: LicenseInput): Promise<License> {
  const now = Date.now()
  const id = newId("lic")
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO licenses (id, name, customer_name, customer_email, license_key, app_id, max_sites, status, expires_at, domains, message, notes, external_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.name, input.customer_name, input.customer_email, generateLicenseKey(), input.app_id, input.max_sites, input.status, input.expires_at, input.domains, input.message, input.notes, input.external_ref ?? null, now, now),
    logChange(env, id, now, input.status, "Licence created"),
  ])
  return (await getLicense(env, id))!
}

export function getLicense(env: Env, id: string): Promise<License | null> {
  return env.DB.prepare(`${SELECT_LICENSES} WHERE l.id = ?`).bind(id).first<License>()
}

export function getLicenseByKey(env: Env, key: string): Promise<License | null> {
  return env.DB.prepare(`${SELECT_LICENSES} WHERE l.license_key = ?`).bind(key).first<License>()
}

export function getLicenseByRef(env: Env, ref: string): Promise<License | null> {
  return env.DB.prepare(`${SELECT_LICENSES} WHERE l.external_ref = ?`).bind(ref).first<License>()
}

export type LicenseFilters = {
  /** A licence status. "active" and "expired" use the effective status (the expiry date is taken into account). */
  status?: string
  q?: string
  externalRef?: string
  appId?: string
  /** Return licences older than this licence id (for paging). */
  before?: string
  limit: number
}

/** Lists licences, newest first. */
export async function queryLicenses(env: Env, filters: LicenseFilters, now = Date.now()): Promise<License[]> {
  const where: string[] = []
  const args: (string | number)[] = []
  const { status } = filters
  if (status === "expired") {
    where.push("(l.status = 'expired' OR (l.status = 'active' AND l.expires_at IS NOT NULL AND l.expires_at <= ?))")
    args.push(now)
  } else if (status === "active") {
    where.push("(l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > ?))")
    args.push(now)
  } else if (status) {
    where.push("l.status = ?")
    args.push(status)
  }
  const search = filters.q?.trim()
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, "\\$&")}%`
    const columns = ["l.name", "l.customer_name", "l.customer_email", "l.license_key", "l.domains", "l.external_ref", "a.name"]
    where.push(`(${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`)
    args.push(...columns.map(() => like))
  }
  if (filters.externalRef) {
    where.push("l.external_ref = ?")
    args.push(filters.externalRef)
  }
  if (filters.appId) {
    where.push("l.app_id = ?")
    args.push(filters.appId)
  }
  if (filters.before) {
    where.push("l.id < ?")
    args.push(filters.before)
  }
  const sql = `${SELECT_LICENSES} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id DESC LIMIT ?`
  return (await env.DB.prepare(sql).bind(...args, filters.limit).all<License>()).results
}

function logChange(env: Env, id: string, at: number, status: string | null, detail: string) {
  return env.DB.prepare("INSERT INTO activity (license_id, at, event, status, detail) VALUES (?, ?, 'change', ?, ?)").bind(id, at, status, detail)
}

export async function updateLicense(env: Env, before: License, input: LicenseInput): Promise<void> {
  const now = Date.now()
  const changes: string[] = []
  if (before.status !== input.status) changes.push(`Status ${before.status} -> ${input.status}`)
  if (before.expires_at !== input.expires_at) changes.push(`Expiry ${formatDate(before.expires_at)} -> ${formatDate(input.expires_at)}`)
  if (before.app_id !== input.app_id) changes.push("App changed")
  if (before.max_sites !== input.max_sites) changes.push(`Site limit ${before.max_sites ?? "unlimited"} -> ${input.max_sites ?? "unlimited"}`)
  if (before.domains !== input.domains) changes.push("Allowed domains changed")
  if (before.message !== input.message) changes.push("Public message changed")
  if (before.name !== input.name || before.customer_name !== input.customer_name || before.customer_email !== input.customer_email || before.notes !== input.notes) changes.push("Details edited")
  const statements = [
    env.DB.prepare(
      `UPDATE licenses SET name = ?, customer_name = ?, customer_email = ?, app_id = ?, max_sites = ?, status = ?, expires_at = ?, domains = ?, message = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).bind(input.name, input.customer_name, input.customer_email, input.app_id, input.max_sites, input.status, input.expires_at, input.domains, input.message, input.notes, now, before.id),
  ]
  if (changes.length) statements.push(logChange(env, before.id, now, input.status, changes.join("; ")))
  await env.DB.batch(statements)
}

function formatDate(ts: number | null): string {
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

/** Moves the expiry date forward by `days`, counted from today if it has already passed. An expired licence becomes active again. */
export async function extendLicense(env: Env, license: License, days: number): Promise<void> {
  const now = Date.now()
  const from = license.expires_at && license.expires_at > now ? license.expires_at : now
  const to = from + days * 86_400_000
  const status: Status = license.status === "expired" ? "active" : license.status
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?").bind(to, status, now, license.id),
    logChange(env, license.id, now, status, `Extended by ${days} days, now expires ${formatDate(to)}`),
  ])
}

/** Sets the expiry date. An expired licence becomes active again; other statuses are kept. */
export async function renewUntil(env: Env, license: License, until: number): Promise<void> {
  const now = Date.now()
  const status: Status = license.status === "expired" ? "active" : license.status
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?").bind(until, status, now, license.id),
    logChange(env, license.id, now, status, `Renewed, now expires ${formatDate(until)}`),
  ])
}

export async function regenerateKey(env: Env, license: License): Promise<void> {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET license_key = ?, updated_at = ? WHERE id = ?").bind(generateLicenseKey(), now, license.id),
    logChange(env, license.id, now, license.status, "Key regenerated. The previous key and check URL no longer work."),
  ])
}

export async function deleteLicense(env: Env, id: string): Promise<void> {
  await deleteLicenseFiles(env, id)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM files WHERE license_id = ?").bind(id),
    env.DB.prepare("DELETE FROM activations WHERE license_id = ?").bind(id),
    env.DB.prepare("DELETE FROM activity WHERE license_id = ?").bind(id),
    env.DB.prepare("DELETE FROM licenses WHERE id = ?").bind(id),
  ])
}

// ---- site activations -----------------------------------------------------------

export async function listActivations(env: Env, licenseId: string): Promise<Activation[]> {
  return (await env.DB.prepare("SELECT domain, first_seen_at, last_seen_at, check_count FROM activations WHERE license_id = ? ORDER BY first_seen_at").bind(licenseId).all<Activation>()).results
}

/**
 * Records that a site checked the licence. A known domain is updated. A new domain is registered, but only
 * while the licence is below its site limit; the limit is enforced in the INSERT itself.
 */
export async function recordActivation(env: Env, license: Pick<License, "id" | "max_sites">, domain: string, now: number): Promise<void> {
  const updated = await env.DB.prepare("UPDATE activations SET last_seen_at = ?, check_count = check_count + 1 WHERE license_id = ? AND domain = ?").bind(now, license.id, domain).run()
  if (updated.meta.changes > 0) return
  if (license.max_sites === null) {
    await env.DB.prepare("INSERT OR IGNORE INTO activations (license_id, domain, first_seen_at, last_seen_at, check_count) VALUES (?, ?, ?, ?, 1)").bind(license.id, domain, now, now).run()
    return
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO activations (license_id, domain, first_seen_at, last_seen_at, check_count)
     SELECT ?, ?, ?, ?, 1 WHERE (SELECT COUNT(*) FROM activations WHERE license_id = ?) < ?`
  ).bind(license.id, domain, now, now, license.id, license.max_sites).run()
}

/** Frees a site slot. The site can register again on its next check, if the licence has room. */
export async function releaseActivation(env: Env, license: License, domain: string): Promise<boolean> {
  const now = Date.now()
  const res = await env.DB.prepare("DELETE FROM activations WHERE license_id = ? AND domain = ?").bind(license.id, domain).run()
  if (res.meta.changes === 0) return false
  await logChange(env, license.id, now, license.status, `Site released: ${domain}`).run()
  return true
}

// ---- activity and statistics ----------------------------------------------------

export async function recentActivity(env: Env, id: string, limit = 50): Promise<Activity[]> {
  const res = await env.DB.prepare("SELECT id, at, event, status, domain, detail FROM activity WHERE license_id = ? ORDER BY at DESC, id DESC LIMIT ?").bind(id, limit).all<Activity>()
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
    // An active licence that no site has checked for 3 days: the site may be offline or no longer calling the check URL.
    if (effective === "active" && now - (r.last_check_at ?? r.created_at) > 3 * 86_400_000) silent++
  }
  return { total: rows.results.length, counts, endingSoon, silent }
}

export async function recentChecks(env: Env, limit = 10) {
  const res = await env.DB.prepare(
    "SELECT a.at, a.status, a.domain, l.id AS license_id, l.name FROM activity a JOIN licenses l ON l.id = a.license_id WHERE a.event = 'check' ORDER BY a.at DESC, a.id DESC LIMIT ?"
  ).bind(limit).all<{ at: number; status: string; domain: string | null; license_id: string; name: string }>()
  return res.results
}

export const CHECK_RETENTION_DAYS = 90

export async function pruneActivity(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM activity WHERE event = 'check' AND at < ?").bind(now - CHECK_RETENTION_DAYS * 86_400_000).run()
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(now - 86_400_000).run()
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run()
}
