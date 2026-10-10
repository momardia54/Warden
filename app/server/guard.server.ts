import { DAY_MS } from "../lib/analytics"
import { normalizeIp } from "../lib/ip"
import { json } from "./util.server"
import type { RateTier } from "../lib/protection"
import { findBlock } from "./ip-blocks.server"
import { applyRules, getProtection, isTrusted } from "./protection.server"

/**
 * Protection of the public endpoints (/check and /download): the IP blocklist and rate limits. Both run before any
 * licence is read, so a refused request costs one cached blocklist lookup and no database query.
 *
 * Rate limits use Cloudflare's Workers rate limiting bindings (wrangler.jsonc, `ratelimits`): one binding per
 * requests-per-minute value, and the protection settings pick which one counts each kind of request. Their counters
 * are kept per Cloudflare location and are eventually consistent: a limit is approximate, never exact. When a binding
 * is missing (an older configuration, tests) or fails, the request is let through: a limiter outage must not take
 * sites down. Addresses on the never-block list are not rate limited.
 */

/** The address of the caller, as Cloudflare reports it. Null when absent (local tools) or not an address. */
export function clientIp(request: Request): string | null {
  return normalizeIp(request.headers.get("cf-connecting-ip"))
}

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> }

async function withinLimit(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true
  try {
    return (await limiter.limit({ key })).success
  } catch (error) {
    console.error("Rate limiter failed:", error)
    return true
  }
}

/** The limiter that counts at `tier` requests per minute, or undefined when the limit is off or not configured. */
function limiterFor(env: Env, tier: RateTier): Limiter | undefined {
  if (tier === 0) return undefined
  return (env as unknown as Partial<Record<string, Limiter>>)[`RATE_LIMIT_${tier}`]
}

// An address over a limit is reported to the rules at most once a minute per Worker instance.
const STRIKE_EVERY_MS = 60_000
let lastStrike = new Map<string, number>()

function strike(env: Env, ctx: ExecutionContext, ip: string | null, now: number) {
  if (!ip || now - (lastStrike.get(ip) ?? 0) < STRIKE_EVERY_MS) return
  if (lastStrike.size > 10_000) lastStrike = new Map()
  lastStrike.set(ip, now)
  ctx.waitUntil(applyRules(env, ip, { kind: "rate_limited" }, now).catch((error) => console.error("Protection rules failed:", error)))
}

// ---- counting refused requests ---------------------------------------------------------
// Refused requests are counted in memory and written at most once a minute per Worker instance, so a flood of
// refused requests does not turn into a flood of database writes. Counts still in memory when an instance stops are
// lost: the figures are approximate.

const FLUSH_EVERY_MS = 60_000
let refused = new Map<string, number>()
let blockHits = new Map<string, { hits: number; last: number }>()
let lastFlush = 0

type RefusalKind = "blocked" | "rate_limited"

function countRefusal(env: Env, ctx: ExecutionContext, kind: RefusalKind, now: number, blockId?: string) {
  const day = Math.floor(now / DAY_MS)
  refused.set(`${day}|${kind}`, (refused.get(`${day}|${kind}`) ?? 0) + 1)
  if (blockId) {
    const hit = blockHits.get(blockId) ?? { hits: 0, last: now }
    blockHits.set(blockId, { hits: hit.hits + 1, last: Math.max(hit.last, now) })
  }
  if (now - lastFlush >= FLUSH_EVERY_MS) {
    lastFlush = now
    ctx.waitUntil(flushRefusals(env).catch((error) => console.error("Failed to record refused requests:", error)))
  }
}

/** Writes the counts kept in memory. Exported for tests. */
export async function flushRefusals(env: Env): Promise<void> {
  const counts = refused
  const hits = blockHits
  refused = new Map()
  blockHits = new Map()
  const statements = [
    ...[...counts].map(([key, n]) => {
      const [day, kind] = key.split("|")
      return env.DB.prepare("INSERT INTO refused_requests (day, kind, count) VALUES (?, ?, ?) ON CONFLICT (day, kind) DO UPDATE SET count = count + excluded.count").bind(Number(day), kind, n)
    }),
    ...[...hits].map(([id, h]) => env.DB.prepare("UPDATE ip_blocks SET hits = hits + ?, last_hit_at = MAX(COALESCE(last_hit_at, 0), ?) WHERE id = ?").bind(h.hits, h.last, id)),
  ]
  if (statements.length > 0) await env.DB.batch(statements)
}

/** Forgets the in-memory state. For tests. */
export function resetGuard() {
  refused = new Map()
  blockHits = new Map()
  lastFlush = 0
  lastStrike = new Map()
}

// ---- the guard -------------------------------------------------------------------------

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" }

/**
 * Returns the refusal for a blocked or rate-limited caller of /check or /download, or null to go on. A blocked
 * caller gets a verdict (`valid: false`, status `blocked`). A rate-limited caller gets no verdict, only `429` with
 * Retry-After: a site that checks too often should keep its last answer, not shut down.
 */
export async function guardPublic(request: Request, env: Env, ctx: ExecutionContext, endpoint: "check" | "download", licenseKey: string, now = Date.now()): Promise<Response | null> {
  if (request.method === "OPTIONS") return null
  const ip = clientIp(request)
  // Counters are named after the installation, so two installs on one Cloudflare account never share them.
  const host = new URL(request.url).host
  const settings = await getProtection(env, now)

  if (ip) {
    const block = await findBlock(env, ip, now)
    if (block) {
      countRefusal(env, ctx, "blocked", now, block.id)
      const message = "Requests from this address are blocked."
      return json(endpoint === "check" ? { valid: false, status: "blocked", message } : { error: message, status: "blocked" }, { status: 403, headers: CORS })
    }
  }

  if (isTrusted(settings, ip)) return null
  const { limits } = settings
  // Each limit value has a binding of its own, so changing a setting starts a fresh count.
  const checks =
    endpoint === "check"
      ? [
          ip ? withinLimit(limiterFor(env, limits.check_ip), `check:${host}:${ip}`) : true,
          withinLimit(limiterFor(env, limits.check_key), `check-key:${host}:${licenseKey}`),
        ]
      : [ip ? withinLimit(limiterFor(env, limits.download_ip), `download:${host}:${ip}`) : true]
  if ((await Promise.all(checks)).every(Boolean)) return null
  countRefusal(env, ctx, "rate_limited", now)
  strike(env, ctx, ip, now)
  return json({ error: "Too many requests. Try again in a minute.", status: "rate_limited" }, { status: 429, headers: { ...CORS, "retry-after": "60" } })
}

/** True while an API key stays under the API rate limit. */
export async function apiWithinLimit(request: Request, env: Env, keyPrefix: string): Promise<boolean> {
  const { limits } = await getProtection(env)
  return withinLimit(limiterFor(env, limits.api_key), `api:${new URL(request.url).host}:${keyPrefix}`)
}

/** After a check or download with a key that does not exist: feeds the "guessing licence keys" rule. */
export function reportUnknownKey(env: Env, ctx: ExecutionContext, request: Request) {
  const ip = clientIp(request)
  if (ip) ctx.waitUntil(applyRules(env, ip, { kind: "invalid_key" }).catch((error) => console.error("Protection rules failed:", error)))
}
