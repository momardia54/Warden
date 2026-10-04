import { buildCheckResponse, KEY_PATTERN, normalizeDomain } from "../lib/license"
import { hmacHex, json } from "./util.server"
import type { License } from "./licenses.server"

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" }

/**
 * Public endpoint: GET or POST /check/<licence key>[?domain=example.com]
 * Answers JSON with `valid` and `status`. The key in the address is the credential. The answer is
 * signed (X-Warden-Signature = HMAC-SHA256 of the body, keyed with the licence key) so a site can
 * confirm the answer really came from this server and was not forged on the way.
 * Known keys always get HTTP 200, unknown keys 404, both with a JSON body.
 */
export async function handleCheck(request: Request, env: Env, ctx: ExecutionContext, key: string): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } })
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Use GET or POST" }, { status: 405, headers: CORS })

  const now = Date.now()
  let domain: string | null = null
  const fromQuery = new URL(request.url).searchParams.get("domain")
  if (fromQuery) domain = normalizeDomain(fromQuery)
  if (!domain && request.method === "POST") {
    try {
      const body = (await request.json()) as { domain?: unknown }
      if (typeof body.domain === "string") domain = normalizeDomain(body.domain)
    } catch {}
  }

  const license = KEY_PATTERN.test(key)
    ? await env.DB.prepare("SELECT * FROM licenses WHERE license_key = ?").bind(key).first<License>()
    : null
  const answer = buildCheckResponse(license, domain, now)
  const body = JSON.stringify(answer)

  if (license) {
    ctx.waitUntil(recordCheck(env, license, answer.status, domain, now).catch((error) => console.error("Warden: could not record check:", error)))
  }
  const headers: Record<string, string> = { ...CORS, "content-type": "application/json; charset=utf-8" }
  if (license) headers["x-warden-signature"] = await hmacHex(license.license_key, body)
  return new Response(body, { status: license ? 200 : 404, headers })
}

async function recordCheck(env: Env, license: License, status: string, domain: string | null, now: number) {
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET last_check_at = ?, last_check_domain = ?, check_count = check_count + 1 WHERE id = ?").bind(now, domain, license.id),
    env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'check', ?, ?, '')").bind(license.id, now, status, domain),
  ])
}
