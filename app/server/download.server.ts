import { latestVersioned } from "../lib/apps"
import { describeStatuses, evaluateFileAccess, type FileAccess } from "../lib/files"
import { buildCheckResponse, KEY_PATTERN, normalizeDomain, type CheckResponse } from "../lib/license"
import { getFileForLicense, listFilesForLicense, releaseRule, type LicenseFile } from "./files.server"
import { getLicenseByKey, listActivations, type License } from "./licenses.server"
import { json } from "./util.server"

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" }
const reply = (body: unknown, status: number) => json(body, { status, headers: CORS })

/**
 * Whether a file can be downloaded by this licence now. Combines the file's release rule with the licence's
 * site rules: when the file requires a matching domain, the domain must also be allowed and within the site limit.
 */
function accessFor(license: License, file: LicenseFile, domain: string | null, check: CheckResponse, now: number): FileAccess {
  const rule = releaseRule(file)
  const access = evaluateFileAccess(license, rule, domain, now)
  if (access.allowed && rule.check_domain && (check.status === "site_limit_reached" || check.status === "domain_mismatch")) {
    return { allowed: false, status: check.status, message: check.message }
  }
  return access
}

/**
 * Public file endpoint. The licence key in the path is the credential.
 *
 *   GET /download/<key>[?domain=example.com]            lists the licence's files and its app's files, with availability
 *   GET /download/<key>/<file id>[?domain=example.com]  returns the file, or a JSON refusal with HTTP 403
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
  if (!license) return reply({ valid: false, status: "unknown", message: "Unknown licence." }, 404)

  const activated = license.max_sites !== null ? (await listActivations(env, license.id)).map((a) => a.domain) : []
  const check = buildCheckResponse(license, domain, now, activated)

  if (!fileId) {
    const entries = (await listFilesForLicense(env, license)).map((f) => {
      const rule = releaseRule(f)
      return {
        id: f.id,
        name: f.name,
        version: f.version,
        notes: f.notes,
        size: f.size,
        source: f.app_id ? "app" : "licence",
        uploaded_at: new Date(f.uploaded_at).toISOString(),
        statuses: rule.statuses,
        check_domain: rule.check_domain,
        available: accessFor(license, f, domain, check, now).allowed,
        download_url: `${url.origin}/download/${license.license_key}/${f.id}`,
      }
    })
    const latest = latestVersioned(entries.filter((e) => e.available))
    return reply(
      { valid: check.valid, status: check.status, message: check.message, app: check.app, latest: latest ? { id: latest.id, name: latest.name, version: latest.version, download_url: latest.download_url } : null, files: entries },
      200
    )
  }

  const file = /^fil_[a-z0-9]+$/.test(fileId) ? await getFileForLicense(env, license, fileId) : null
  if (!file) return reply({ error: "File not found for this licence." }, 404)

  const access = accessFor(license, file, domain, check, now)
  if (!access.allowed) {
    ctx.waitUntil(logDownload(env, license, file, access.status, domain, now, false).catch((e) => console.error("Failed to log download:", e)))
    return reply({ valid: false, status: access.status, message: access.message, file: { id: file.id, name: file.name, statuses: releaseRule(file).statuses } }, 403)
  }
  if (!env.FILES) return reply({ error: "File storage is not configured." }, 501)
  const object = await env.FILES.get(file.r2_key)
  if (!object) return reply({ error: "The file is missing from storage." }, 404)

  ctx.waitUntil(logDownload(env, license, file, access.status, domain, now, true).catch((e) => console.error("Failed to log download:", e)))
  return new Response(object.body, {
    status: 200,
    headers: {
      ...CORS,
      "content-type": file.content_type,
      "content-length": String(object.size),
      "content-disposition": `attachment; filename="${file.name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
    },
  })
}

async function logDownload(env: Env, license: License, file: LicenseFile, status: string, domain: string | null, now: number, granted: boolean) {
  const detail = granted ? `Downloaded: ${file.name}` : `Download refused: ${file.name} (available when ${describeStatuses(releaseRule(file).statuses)})`
  const statements = [env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'download', ?, ?, ?)").bind(license.id, now, status, domain, detail)]
  if (granted) statements.push(env.DB.prepare("UPDATE files SET download_count = download_count + 1, last_download_at = ? WHERE id = ?").bind(now, file.id))
  await env.DB.batch(statements)
}
