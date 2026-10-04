import type { Scope } from "../lib/license"
import { json } from "./util.server"

export const MAX_BODY_BYTES = 64 * 1024

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-API-Key",
  "access-control-max-age": "86400",
}

export function reply(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return json(body, { status, headers: { ...CORS, "cache-control": "no-store", ...extra } })
}

export function fail(status: number, code: string, message: string): Response {
  return reply({ error: { code, message } }, status)
}

export const iso = (ts: number | null): string | null => (ts ? new Date(ts).toISOString() : null)

/** Reads a JSON object from the request body, enforcing the size limit. Returns an error response if invalid. */
export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "too_large", "The request body exceeds 64 KB.")
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) return fail(413, "too_large", "The request body exceeds 64 KB.")
  if (!body.trim()) return {}
  try {
    const value = JSON.parse(body)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(400, "invalid_json", "The request body must be a JSON object.")
    return value as Record<string, unknown>
  } catch {
    return fail(400, "invalid_json", "The request body is not valid JSON.")
  }
}

const LEVEL: Record<Scope, number> = { read: 0, manage: 1, full: 2 }

/** Returns a 403 response when the key's permission level is below `required`, otherwise null. */
export function requirePermission(keyScope: Scope, required: Scope): Response | null {
  return LEVEL[keyScope] >= LEVEL[required] ? null : fail(403, "forbidden", `This API key has "${keyScope}" permission. This action requires "${required}".`)
}

/** Parses an expiry date: "2027-03-31" (valid through the end of that day, UTC) or an ISO date-time. null clears it. */
export function parseExpiry(value: unknown): number | null | "invalid" {
  if (value === null) return null
  if (typeof value !== "string") return "invalid"
  const v = value.trim()
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T23:59:59.999Z`) : /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : NaN
  return Number.isNaN(ms) ? "invalid" : ms
}

export const trimmed = (value: unknown, max: number): string | null => (typeof value === "string" ? value.trim().slice(0, max) : null)
