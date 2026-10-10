import { buildCheckResponse, KEY_PATTERN, normalizeDomain, type CheckResponse } from "../lib/license"
import { clientIp, reportUnknownKey } from "./guard.server"
import { applyRules } from "./protection.server"
import { compareVersions, isChannel, latestRelease, readReportedVersion, type Channel } from "../lib/releases"
import { DEFAULT_STATUSES } from "../lib/statuses"
import { releaseSummary, visibleFiles } from "./download.server"
import { getLicenseByKey, listActivations, recordActivation, type License } from "./licenses.server"
import { getStatusSetForLicense } from "./statuses.server"
import { readTextUpTo } from "./api-http.server"
import { hmacHex, json } from "./util.server"

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "X-Warden-Signature", "cache-control": "no-store" }

export const MAX_CHECK_BODY_BYTES = 4096

/** What a site sends with a check: its domain, and optionally the version it runs and the release channel it follows. */
type CheckRequest = { domain: string | null; version: string | null; channel: Channel }

async function readCheckRequest(request: Request): Promise<CheckRequest> {
  const q = new URL(request.url).searchParams
  let body: Record<string, unknown> = {}
  if (request.method === "POST") {
    // Only a small JSON body is expected. A larger body is ignored and is not read beyond the limit.
    const text = await readTextUpTo(request, MAX_CHECK_BODY_BYTES)
    if (text) {
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed
      } catch {}
    }
  }
  // The query string wins over the body, as it always has for the domain.
  const pick = (name: string) => q.get(name) ?? (typeof body[name] === "string" ? (body[name] as string) : null)
  const domainRaw = pick("domain")
  const channel = pick("channel")
  return { domain: domainRaw ? normalizeDomain(domainRaw) : null, version: readReportedVersion(pick("version")), channel: isChannel(channel) ? channel : "stable" }
}

/**
 * Public endpoint: GET or POST /check/<licence key>[?domain=example.com][&version=1.3.0][&channel=beta]
 *
 * Returns JSON with `valid` and `status`. The licence key in the path is the credential. The response is signed:
 * X-Warden-Signature is the HMAC-SHA256 of the body, keyed with the licence key, so a site can verify that it
 * came from this server unmodified. A known key returns HTTP 200 and an unknown key 404, both with a JSON body.
 * When a domain is sent, the site is registered as an activation of the licence (within the licence's site limit).
 * When a version is sent, the response includes `update`: the newest release this licence can download and whether
 * it is newer than the site's version, and the version is recorded for the site.
 */
export async function handleCheck(request: Request, env: Env, ctx: ExecutionContext, key: string): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } })
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Use GET or POST" }, { status: 405, headers: CORS })

  const now = Date.now()
  const { domain, version, channel } = await readCheckRequest(request)

  const license = KEY_PATTERN.test(key) ? await getLicenseByKey(env, key) : null
  // Activations only matter for the limit, so they are loaded only for licences that have one.
  const activated = license && license.max_sites !== null ? (await listActivations(env, license.id)).map((a) => a.domain) : []
  const set = license ? await getStatusSetForLicense(env, license) : DEFAULT_STATUSES
  const result: CheckResponse = buildCheckResponse(license, domain, now, activated, set)
  if (license && version) {
    const files = await visibleFiles(env, license, domain, result, now, set, new URL(request.url).origin)
    const latest = latestRelease(files.filter((f) => f.available), channel)
    result.update = { current: version, available: Boolean(latest && compareVersions(latest.version, version) > 0), latest: latest ? releaseSummary(latest, domain) : null }
  }
  const body = JSON.stringify(result)

  if (license) {
    const ip = clientIp(request)
    ctx.waitUntil(
      recordCheck(env, license, result.status, domain, version, ip, now)
        // The rules read the check just recorded.
        .then(() => applyRules(env, ip, { kind: "check", refused: !result.valid }, now))
        .catch((error) => console.error("Failed to record check:", error))
    )
  } else reportUnknownKey(env, ctx, request)
  const headers: Record<string, string> = { ...CORS, "content-type": "application/json; charset=utf-8" }
  if (license) headers["x-warden-signature"] = await hmacHex(license.license_key, body)
  return new Response(body, { status: license ? 200 : 404, headers })
}

async function recordCheck(env: Env, license: License, status: string, domain: string | null, version: string | null, ip: string | null, now: number) {
  // A site refused for its domain or the site limit is not registered.
  if (domain && status !== "domain_mismatch" && status !== "site_limit_reached") await recordActivation(env, license, domain, now, version, ip)
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET last_check_at = ?, last_check_domain = ?, check_count = check_count + 1 WHERE id = ?").bind(now, domain, license.id),
    env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail, ip) VALUES (?, ?, 'check', ?, ?, ?, ?)").bind(license.id, now, status, domain, version ? `Version ${version}` : "", ip),
  ])
}
