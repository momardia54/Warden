import { effectiveStatus, isStatus, KEY_PATTERN, parseDomains, normalizeDomain, STATUSES, type Status } from "../lib/license"
import {
  createLicense, deleteLicense, extendLicense, getLicense, getLicenseByRef, overviewStats, recentActivity, regenerateKey,
  renewUntil, setStatus, updateLicense, type Activity, type License, type LicenseInput,
} from "./licenses.server"
import { openApiSpec } from "./openapi.server"
import { json, newId, randomString, sha256Hex } from "./util.server"

const MAX_BODY = 64 * 1024
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-API-Key",
  "access-control-max-age": "86400",
}

export const SCOPES = ["read", "manage", "full"] as const
export type Scope = (typeof SCOPES)[number]
const LEVEL: Record<Scope, number> = { read: 0, manage: 1, full: 2 }

function reply(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return json(body, { status, headers: { ...CORS, "cache-control": "no-store", ...extra } })
}
function fail(status: number, code: string, message: string): Response {
  return reply({ error: { code, message } }, status)
}

// ---- API keys -------------------------------------------------------------------

export type ApiKeyRow = { id: string; name: string; prefix: string; scope: Scope; created_at: number; last_used_at: number | null }

export async function createApiKey(env: Env, name: string, scope: Scope): Promise<{ id: string; secret: string }> {
  const secret = `wk_${randomString(40)}`
  const id = newId("key")
  await env.DB.prepare("INSERT INTO api_keys (id, name, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, secret.slice(0, 7), await sha256Hex(secret), scope, Date.now())
    .run()
  return { id, secret }
}

export async function listApiKeys(env: Env): Promise<ApiKeyRow[]> {
  return (await env.DB.prepare("SELECT id, name, prefix, scope, created_at, last_used_at FROM api_keys ORDER BY created_at DESC").all<ApiKeyRow>()).results
}

export async function revokeApiKey(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM api_keys WHERE id = ?").bind(id).run()
}

async function authenticate(request: Request, env: Env, ctx: ExecutionContext): Promise<ApiKeyRow | null> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (request.headers.get("x-api-key") ?? "").trim()
  if (!/^wk_[A-Za-z0-9]{40}$/.test(token)) return null
  const row = await env.DB.prepare("SELECT id, name, prefix, scope, created_at, last_used_at FROM api_keys WHERE key_hash = ?").bind(await sha256Hex(token)).first<ApiKeyRow>()
  if (row && (!row.last_used_at || Date.now() - row.last_used_at > 60_000)) {
    ctx.waitUntil(env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.id).run().then(() => {}, () => {}))
  }
  return row
}

// ---- shapes ---------------------------------------------------------------------

const iso = (ts: number | null) => (ts ? new Date(ts).toISOString() : null)

export function publicLicense(l: License, origin: string) {
  const status = effectiveStatus(l)
  return {
    id: l.id,
    name: l.name,
    client: l.client,
    key: l.license_key,
    check_url: `${origin}/check/${l.license_key}`,
    status,
    stored_status: l.status,
    valid: status === "active",
    expires_at: iso(l.expires_at),
    domains: parseDomains(l.domains),
    message: l.message,
    notes: l.notes,
    external_ref: l.external_ref,
    created_at: iso(l.created_at),
    updated_at: iso(l.updated_at),
    last_check_at: iso(l.last_check_at),
    last_check_domain: l.last_check_domain,
    check_count: l.check_count,
  }
}

const publicActivity = (a: Activity) => ({ at: iso(a.at), kind: a.kind, status: a.status, domain: a.domain, detail: a.detail })

// ---- input ----------------------------------------------------------------------

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "too_large", "The body is larger than 64 KB.")
  const text = await request.text()
  if (text.length > MAX_BODY) return fail(413, "too_large", "The body is larger than 64 KB.")
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(400, "invalid_json", "The body must be a JSON object.")
    return value as Record<string, unknown>
  } catch {
    return fail(400, "invalid_json", "The body is not valid JSON.")
  }
}

/** "2027-03-31" (end of that day, UTC) or a full ISO date-time. null clears it. */
export function parseEndDate(value: unknown): number | null | "invalid" {
  if (value === null) return null
  if (typeof value !== "string") return "invalid"
  const v = value.trim()
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T23:59:59.999Z`) : /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : NaN
  return Number.isNaN(ms) ? "invalid" : ms
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null)

type Parsed = { input: LicenseInput } | { response: Response }

/** Merges a JSON body over `base` (an existing licence, or defaults for a new one) and validates it. */
export function applyBody(body: Record<string, unknown>, base: LicenseInput): Parsed {
  const input = { ...base }
  if ("name" in body) {
    const name = text(body.name, 120)
    if (!name) return { response: fail(422, "invalid_name", "name must be a non-empty string of at most 120 characters.") }
    input.name = name
  }
  for (const [field, max] of [["client", 120], ["message", 300], ["notes", 4000]] as const) {
    if (field in body) {
      const v = text(body[field], max)
      if (v === null) return { response: fail(422, `invalid_${field}`, `${field} must be a string.`) }
      input[field] = v
    }
  }
  if ("status" in body) {
    if (!isStatus(body.status) || body.status === "expired") {
      return { response: fail(422, "invalid_status", `status must be one of: ${STATUSES.filter((s) => s !== "expired").join(", ")}. "expired" is set by the end date.`) }
    }
    input.status = body.status
  }
  if ("expires_at" in body) {
    const end = parseEndDate(body.expires_at)
    if (end === "invalid") return { response: fail(422, "invalid_expires_at", "expires_at must be null, YYYY-MM-DD or an ISO date-time.") }
    input.expires_at = end
  } else if ("duration_days" in body) {
    const d = Number(body.duration_days)
    if (!Number.isInteger(d) || d < 1 || d > 3650) return { response: fail(422, "invalid_duration_days", "duration_days must be a whole number from 1 to 3650.") }
    input.expires_at = Date.now() + d * 86_400_000
  }
  if ("domains" in body) {
    const list = Array.isArray(body.domains) ? body.domains : typeof body.domains === "string" ? body.domains.split(/[\s,]+/).filter(Boolean) : null
    if (!list || list.some((d) => typeof d !== "string" || !normalizeDomain(d))) {
      return { response: fail(422, "invalid_domains", "domains must be an array of valid domain names (or a comma-separated string).") }
    }
    input.domains = parseDomains((list as string[]).join(" ")).join(", ")
  }
  return { input }
}

const DEFAULTS: LicenseInput = { name: "", client: "", status: "active", expires_at: null, domains: "", message: "", notes: "" }
const asInput = (l: License): LicenseInput => ({ name: l.name, client: l.client, status: l.status, expires_at: l.expires_at, domains: l.domains, message: l.message, notes: l.notes })

// ---- routes ---------------------------------------------------------------------

function need(key: ApiKeyRow, scope: Scope): Response | null {
  return LEVEL[key.scope] >= LEVEL[scope] ? null : fail(403, "forbidden", `This key has "${key.scope}" access. This action needs "${scope}".`)
}

async function findLicense(env: Env, idOrKey: string): Promise<License | null> {
  if (KEY_PATTERN.test(idOrKey.toUpperCase())) {
    return env.DB.prepare("SELECT * FROM licenses WHERE license_key = ?").bind(idOrKey.toUpperCase()).first<License>()
  }
  return /^lic_[a-z0-9]+$/.test(idOrKey) ? getLicense(env, idOrKey) : null
}

async function listLicensesApi(env: Env, url: URL, origin: string): Promise<Response> {
  const q = url.searchParams
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 25))
  const where: string[] = []
  const args: (string | number)[] = []
  const now = Date.now()
  const status = q.get("status")
  if (status) {
    if (!isStatus(status)) return fail(422, "invalid_status", `status must be one of: ${STATUSES.join(", ")}.`)
    if (status === "expired") { where.push("(status = 'expired' OR (status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?))"); args.push(now) }
    else if (status === "active") { where.push("(status = 'active' AND (expires_at IS NULL OR expires_at > ?))"); args.push(now) }
    else { where.push("status = ?"); args.push(status) }
  }
  const search = q.get("q")?.trim()
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, "\\$&")}%`
    where.push("(name LIKE ? ESCAPE '\\' OR client LIKE ? ESCAPE '\\' OR license_key LIKE ? ESCAPE '\\' OR domains LIKE ? ESCAPE '\\' OR external_ref LIKE ? ESCAPE '\\')")
    args.push(like, like, like, like, like)
  }
  const ref = q.get("external_ref")
  if (ref) { where.push("external_ref = ?"); args.push(ref) }
  const before = q.get("before")
  if (before) { where.push("id < ?"); args.push(before) }
  const rows = (await env.DB.prepare(`SELECT * FROM licenses ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).bind(...args, limit + 1).all<License>()).results
  const page = rows.slice(0, limit)
  return reply({ data: page.map((l) => publicLicense(l, origin)), next: rows.length > limit ? page[page.length - 1].id : null })
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const origin = url.origin
  const method = request.method
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/+$/, "") || "/"

  if (path === "/openapi.json" && method === "GET") return reply(openApiSpec(origin))

  const key = await authenticate(request, env, ctx)
  if (!key) return fail(401, "unauthorized", "Send a valid API key as Authorization: Bearer wk_...")

  if (path === "/me" && method === "GET") return reply({ name: key.name, scope: key.scope, prefix: key.prefix })
  if (path === "/stats" && method === "GET") return reply(await overviewStats(env))

  if (path === "/licenses") {
    if (method === "GET") return listLicensesApi(env, url, origin)
    if (method === "POST") {
      const denied = need(key, "manage")
      if (denied) return denied
      const body = await readJson(request)
      if (body instanceof Response) return body
      const ref = body.external_ref === undefined || body.external_ref === null ? null : text(body.external_ref, 120)
      if (body.external_ref !== undefined && body.external_ref !== null && !ref) return fail(422, "invalid_external_ref", "external_ref must be a non-empty string of at most 120 characters.")
      if (ref) {
        const existing = await getLicenseByRef(env, ref)
        if (existing) return reply(publicLicense(existing, origin), 200, { "idempotent-replayed": "true" })
      }
      if (!("name" in body)) return fail(422, "invalid_name", "name is required.")
      const parsed = applyBody(body, DEFAULTS)
      if ("response" in parsed) return parsed.response
      try {
        const created = await createLicense(env, { ...parsed.input, external_ref: ref })
        return reply(publicLicense(created, origin), 201)
      } catch (error) {
        // Two requests with the same reference racing: the unique index lets one win, the other gets that licence.
        const existing = ref ? await getLicenseByRef(env, ref) : null
        if (existing) return reply(publicLicense(existing, origin), 200, { "idempotent-replayed": "true" })
        throw error
      }
    }
    return fail(405, "method_not_allowed", "Use GET or POST.")
  }

  const m = path.match(/^\/licenses\/([A-Za-z0-9_-]+)(?:\/(status|renew|regenerate-key|activity))?$/)
  if (!m) return fail(404, "not_found", "Unknown endpoint. See /api/v1/openapi.json.")
  const license = await findLicense(env, m[1])
  if (!license) return fail(404, "license_not_found", "No licence with that id or key.")
  const sub = m[2]

  if (!sub) {
    if (method === "GET") return reply(publicLicense(license, origin))
    if (method === "PATCH") {
      const denied = need(key, "manage")
      if (denied) return denied
      const body = await readJson(request)
      if (body instanceof Response) return body
      const parsed = applyBody(body, asInput(license))
      if ("response" in parsed) return parsed.response
      await updateLicense(env, license, parsed.input)
      return reply(publicLicense((await getLicense(env, license.id))!, origin))
    }
    if (method === "DELETE") {
      const denied = need(key, "full")
      if (denied) return denied
      await deleteLicense(env, license.id)
      return reply({ deleted: true, id: license.id })
    }
    return fail(405, "method_not_allowed", "Use GET, PATCH or DELETE.")
  }

  if (sub === "activity") {
    if (method !== "GET") return fail(405, "method_not_allowed", "Use GET.")
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50))
    return reply({ data: (await recentActivity(env, license.id, limit)).map(publicActivity) })
  }

  if (method !== "POST") return fail(405, "method_not_allowed", "Use POST.")
  const denied = need(key, sub === "regenerate-key" ? "full" : "manage")
  if (denied) return denied
  const body = await readJson(request)
  if (body instanceof Response) return body

  if (sub === "status") {
    if (!isStatus(body.status) || body.status === "expired") return fail(422, "invalid_status", `status must be one of: ${STATUSES.filter((s) => s !== "expired").join(", ")}.`)
    await setStatus(env, license, body.status as Status)
  } else if (sub === "renew") {
    if ("until" in body) {
      const end = parseEndDate(body.until)
      if (end === "invalid" || end === null || end <= Date.now()) return fail(422, "invalid_until", "until must be YYYY-MM-DD or an ISO date-time, in the future.")
      await renewUntil(env, license, end)
    } else {
      const days = Number(body.days)
      if (!Number.isInteger(days) || days < 1 || days > 3650) return fail(422, "invalid_days", "Send days (1 to 3650) or until (a date).")
      await extendLicense(env, license, days)
    }
  } else {
    await regenerateKey(env, license)
  }
  return reply(publicLicense((await getLicense(env, license.id))!, origin))
}
