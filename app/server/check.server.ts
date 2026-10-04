import { buildCheckResponse, KEY_PATTERN, normalizeDomain } from "../lib/license"
import { getLicenseByKey, listActivations, recordActivation, type License } from "./licenses.server"
import { hmacHex, json } from "./util.server"

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" }

/**
 * Public endpoint: GET or POST /check/<licence key>[?domain=example.com]
 *
 * Returns JSON with `valid` and `status`. The licence key in the path is the credential. The response is signed:
 * X-Warden-Signature is the HMAC-SHA256 of the body, keyed with the licence key, so a site can verify that it
 * came from this server unmodified. A known key returns HTTP 200 and an unknown key 404, both with a JSON body.
 * When a domain is sent, the site is registered as an activation of the licence (within the licence's site limit).
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

  const license = KEY_PATTERN.test(key) ? await getLicenseByKey(env, key) : null
  // Activations only matter for the limit, so they are loaded only for licences that have one.
  const activated = license && license.max_sites !== null ? (await listActivations(env, license.id)).map((a) => a.domain) : []
  const result = buildCheckResponse(license, domain, now, activated)
  const body = JSON.stringify(result)

  if (license) {
    ctx.waitUntil(recordCheck(env, license, result.status, domain, now).catch((error) => console.error("Failed to record check:", error)))
  }
  const headers: Record<string, string> = { ...CORS, "content-type": "application/json; charset=utf-8" }
  if (license) headers["x-warden-signature"] = await hmacHex(license.license_key, body)
  return new Response(body, { status: license ? 200 : 404, headers })
}

async function recordCheck(env: Env, license: License, status: string, domain: string | null, now: number) {
  // A site refused for its domain or the site limit is not registered.
  if (domain && status !== "domain_mismatch" && status !== "site_limit_reached") await recordActivation(env, license, domain, now)
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET last_check_at = ?, last_check_domain = ?, check_count = check_count + 1 WHERE id = ?").bind(now, domain, license.id),
    env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'check', ?, ?, '')").bind(license.id, now, status, domain),
  ])
}
