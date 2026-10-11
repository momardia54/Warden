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
  return json(body, { status, headers: { ...CORS, "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } })
}

/**
 * Reads a request body as text, stopping as soon as it exceeds `limit` bytes. Returns null when it is too large, so a
 * body without a Content-Length header cannot make the Worker buffer more than the limit.
 */
export async function readTextUpTo(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export function fail(status: number, code: string, message: string): Response {
  return reply({ error: { code, message } }, status)
}

export const iso = (ts: number | null): string | null => (ts ? new Date(ts).toISOString() : null)

/** Reads a JSON object from the request body, enforcing the size limit. Returns an error response if invalid. */
export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const body = await readTextUpTo(request, MAX_BODY_BYTES)
  if (body === null) return fail(413, "too_large", "The request body exceeds 64 KB.")
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

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

/** The page size of a list request: ?limit= from 1 to 100, 50 by default. */
export function readLimit(q: URLSearchParams): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(q.get("limit"))) || DEFAULT_PAGE_SIZE))
}

/**
 * One page of a list that is read whole: `{ data, next }`. ?cursor= is the `next` of the previous page (the id of its
 * last item); `next` is null on the last page. An unknown cursor is an error, so a client never silently restarts.
 */
export function pageOf<T>(items: T[], idOf: (item: T) => string, q: URLSearchParams): { data: T[]; next: string | null } | Response {
  const limit = readLimit(q)
  const cursor = q.get("cursor")
  let start = 0
  if (cursor) {
    const index = items.findIndex((item) => idOf(item) === cursor)
    if (index < 0) return fail(422, "invalid_cursor", "cursor must be the next value of a previous page of this list.")
    start = index + 1
  }
  const data = items.slice(start, start + limit)
  return { data, next: start + limit < items.length ? idOf(data[data.length - 1]) : null }
}

export const unknownEndpoint = () => fail(404, "not_found", "Unknown endpoint. See /api/v1/openapi.json.")
