import { evaluateFileAccess, type FileAccess } from "../lib/files"
import { clientIp, reportUnknownKey } from "./guard.server"
import { buildCheckResponse, KEY_PATTERN, normalizeDomain, type CheckResponse } from "../lib/license"
import { isChannel, latestRelease, type Channel } from "../lib/releases"
import { describeStatusKeys, type StatusSet } from "../lib/statuses"
import { getFileForLicense, listFilesForLicense, releaseRule, type LicenseFile } from "./files.server"
import { getLicenseByKey, listActivations, type License } from "./licenses.server"
import { getStatusSetForLicense } from "./statuses.server"
import { json } from "./util.server"

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "X-Warden-Sha256", "cache-control": "no-store" }
const reply = (body: unknown, status: number) => json(body, { status, headers: CORS })

/**
 * Content-Disposition for a download. Header values must be Latin-1, so the plain `filename` gets an ASCII version of
 * the name and `filename*` carries the exact name, percent-encoded as UTF-8 (RFC 6266 / RFC 5987).
 */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "") || "download"
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Whether a file can be downloaded by this licence now. Combines the file's release rule with the licence's
 * site rules: when the file requires a matching domain, the domain must also be allowed and within the site limit.
 */
function accessFor(license: License, file: LicenseFile, domain: string | null, check: CheckResponse, now: number, set: StatusSet): FileAccess {
  const rule = releaseRule(file, set)
  const access = evaluateFileAccess(license, rule, domain, now, false, set)
  if (access.allowed && rule.check_domain && (check.status === "site_limit_reached" || check.status === "domain_mismatch")) {
    return { allowed: false, status: check.status, message: check.message }
  }
  return access
}

/** A file as a licence sees it: its release rule, whether it can be downloaded now, and its download link. */
export type VisibleFile = {
  id: string
  name: string
  version: string
  channel: Channel
  changelog: string
  size: number
  sha256: string
  source: "licence" | "app"
  uploaded_at: number
  withdrawn_at: null
  statuses: string[]
  check_domain: boolean
  available: boolean
  download_url: string
}

/**
 * The files a licence can see (its own and its app's), without withdrawn releases, each with its availability for the
 * given domain. `check` is the licence's check result for that domain, which carries the site rules. `set` is the
 * licence's status set: it is also the set every one of these files refers to, because a licence in an app uses the
 * app's statuses and a standalone licence sees no app files.
 */
export async function visibleFiles(env: Env, license: License, domain: string | null, check: CheckResponse, now: number, set: StatusSet, origin: string): Promise<VisibleFile[]> {
  const files = (await listFilesForLicense(env, license)).filter((f) => f.withdrawn_at === null)
  return files.map((f) => {
    const rule = releaseRule(f, set)
    return {
      id: f.id,
      name: f.name,
      version: f.version,
      channel: f.channel,
      changelog: f.changelog,
      size: f.size,
      sha256: f.sha256,
      source: f.app_id ? "app" : "licence",
      uploaded_at: f.uploaded_at,
      withdrawn_at: null,
      statuses: rule.statuses,
      check_domain: rule.check_domain,
      available: accessFor(license, f, domain, check, now, set).allowed,
      download_url: `${origin}/download/${license.license_key}/${f.id}`,
    }
  })
}

/** The fields of a release a site needs to offer an update. */
export function releaseSummary(f: VisibleFile, domain: string | null = null) {
  return {
    id: f.id,
    name: f.name,
    version: f.version,
    channel: f.channel,
    changelog: f.changelog,
    size: f.size,
    sha256: f.sha256 || null,
    released_at: new Date(f.uploaded_at).toISOString(),
    download_url: domain ? `${f.download_url}?domain=${encodeURIComponent(domain)}` : f.download_url,
  }
}

/** A file in the public download list. Internal notes are never included. */
const publicEntry = (f: VisibleFile) => ({
  id: f.id,
  name: f.name,
  version: f.version,
  channel: f.channel,
  changelog: f.changelog,
  size: f.size,
  sha256: f.sha256 || null,
  source: f.source,
  uploaded_at: new Date(f.uploaded_at).toISOString(),
  statuses: f.statuses,
  check_domain: f.check_domain,
  available: f.available,
  download_url: f.download_url,
})

/**
 * Public file endpoint. The licence key in the path is the credential.
 *
 *   GET /download/<key>[?domain=example.com][&channel=beta]  lists the licence's files and its app's files, with
 *                                                          availability and the latest release in the channel
 *   GET /download/<key>/<file id>[?domain=example.com]       returns the file, a JSON error with HTTP 403, or 410
 *                                                          for a withdrawn release
 *
 * A file is released when the licence's effective status is one of the file's release statuses and, if the
 * file requires it, the requesting domain is allowed for the licence.
 */
export async function handleDownload(request: Request, env: Env, ctx: ExecutionContext, key: string, fileId: string | null): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET" } })
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "Method not allowed. Use GET." }, 405)

  const url = new URL(request.url)
  const domainParam = url.searchParams.get("domain")
  const domain = domainParam ? normalizeDomain(domainParam) : null
  const now = Date.now()

  const license = KEY_PATTERN.test(key) ? await getLicenseByKey(env, key) : null
  if (!license) {
    reportUnknownKey(env, ctx, request)
    return reply({ valid: false, status: "unknown", message: "Unknown licence." }, 404)
  }

  const activated = license.max_sites !== null ? (await listActivations(env, license.id)).map((a) => a.domain) : []
  const set = await getStatusSetForLicense(env, license)
  const check = buildCheckResponse(license, domain, now, activated, set)

  if (!fileId) {
    const channelParam = url.searchParams.get("channel") ?? "stable"
    const channel: Channel = isChannel(channelParam) ? channelParam : "stable"
    const entries = await visibleFiles(env, license, domain, check, now, set, url.origin)
    const latest = latestRelease(entries.filter((e) => e.available), channel)
    return reply({ valid: check.valid, status: check.status, message: check.message, app: check.app, latest: latest ? releaseSummary(latest) : null, files: entries.map(publicEntry) }, 200)
  }

  const file = /^fil_[a-z0-9]+$/.test(fileId) ? await getFileForLicense(env, license, fileId) : null
  if (!file) return reply({ error: "File not found for this licence." }, 404)
  if (file.withdrawn_at !== null) return reply({ valid: false, status: "withdrawn", message: "This release has been withdrawn.", file: { id: file.id, name: file.name, version: file.version } }, 410)

  const access = accessFor(license, file, domain, check, now, set)
  if (!access.allowed) {
    ctx.waitUntil(logDownload(env, license, file, access.status, domain, clientIp(request), now, false, set).catch((e) => console.error("Failed to log download:", e)))
    return reply({ valid: false, status: access.status, message: access.message, file: { id: file.id, name: file.name, statuses: releaseRule(file, set).statuses } }, 403)
  }
  if (!env.FILES) return reply({ error: "File storage is not configured." }, 501)
  const object = await env.FILES.get(file.r2_key)
  if (!object) return reply({ error: "The file is missing from storage." }, 404)

  const headers: Record<string, string> = {
    ...CORS,
    "content-type": file.content_type,
    "content-length": String(object.size),
    "content-disposition": contentDisposition(file.name),
    "x-content-type-options": "nosniff",
    // The file is served from the dashboard's origin. If a browser ever rendered it instead of downloading it, this
    // keeps it from running scripts or reaching anything.
    "content-security-policy": "default-src 'none'; sandbox",
  }
  if (file.sha256) headers["x-warden-sha256"] = file.sha256
  // A HEAD request only asks for the headers: it is not a download and is not counted.
  if (request.method === "HEAD") {
    object.body.cancel().catch(() => {})
    return new Response(null, { status: 200, headers })
  }
  ctx.waitUntil(logDownload(env, license, file, access.status, domain, clientIp(request), now, true, set).catch((e) => console.error("Failed to log download:", e)))
  return new Response(object.body, { status: 200, headers })
}

async function logDownload(env: Env, license: License, file: LicenseFile, status: string, domain: string | null, ip: string | null, now: number, granted: boolean, set: StatusSet) {
  const detail = granted ? `Downloaded: ${file.name}` : `Download refused: ${file.name} (available when ${describeStatusKeys(releaseRule(file, set).statuses, set)})`
  const statements = [env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail, ip) VALUES (?, ?, 'download', ?, ?, ?, ?)").bind(license.id, now, status, domain, detail, ip)]
  if (granted) statements.push(env.DB.prepare("UPDATE files SET download_count = download_count + 1, last_download_at = ? WHERE id = ?").bind(now, file.id))
  await env.DB.batch(statements)
}
