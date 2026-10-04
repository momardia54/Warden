import { fileAccess, KIND_LABEL } from "../lib/files"
import { buildAnswer, KEY_PATTERN, normalizeDomain } from "../lib/license"
import { getFile, listFiles, type LicenseFile } from "./files.server"
import type { License } from "./licenses.server"
import { json } from "./util.server"

const CORS = { "access-control-allow-origin": "*", "cache-control": "no-store" }
const reply = (body: unknown, status: number) => json(body, { status, headers: CORS })

/**
 * Public downloads, authenticated by the licence key in the address:
 *   GET /download/<key>[?domain=site.org]            lists the files and whether each can be downloaded now
 *   GET /download/<key>/<file id>[?domain=site.org]  the file itself, or a JSON refusal (HTTP 403)
 * `update` files need a licence in force (active or completed) and, when the licence lists domains, a matching
 * domain. `final` files need status completed (paid in full) and ignore domains.
 */
export async function handleDownload(request: Request, env: Env, ctx: ExecutionContext, key: string, fileId: string | null): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET" } })
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "Use GET" }, 405)

  const url = new URL(request.url)
  const domainParam = url.searchParams.get("domain")
  const domain = domainParam ? normalizeDomain(domainParam) : null
  const now = Date.now()

  const license = KEY_PATTERN.test(key) ? await env.DB.prepare("SELECT * FROM licenses WHERE license_key = ?").bind(key).first<License>() : null
  if (!license) return reply({ valid: false, status: "unknown", message: "Unknown licence." }, 404)

  if (!fileId) {
    const answer = buildAnswer(license, domain, now)
    const files = (await listFiles(env, license.id)).map((f) => {
      const access = fileAccess(license, f.kind, domain, now)
      return { id: f.id, name: f.name, kind: f.kind, version: f.version, notes: f.notes, size: f.size, uploaded_at: new Date(f.uploaded_at).toISOString(), available: access.allowed, download_url: `${url.origin}/download/${license.license_key}/${f.id}` }
    })
    return reply({ valid: answer.valid, status: answer.status, message: answer.message, files }, 200)
  }

  const file = /^fil_[a-z0-9]+$/.test(fileId) ? await getFile(env, license.id, fileId) : null
  if (!file) return reply({ error: "No such file on this licence." }, 404)

  const access = fileAccess(license, file.kind, domain, now)
  if (!access.allowed) {
    ctx.waitUntil(record(env, license, file, access.status, domain, now, false).catch((e) => console.error("Warden: could not log download:", e)))
    return reply({ valid: false, status: access.status, message: access.message, file: { id: file.id, name: file.name, kind: file.kind } }, 403)
  }
  if (!env.FILES) return reply({ error: "File storage is not set up." }, 501)
  const object = await env.FILES.get(file.r2_key)
  if (!object) return reply({ error: "The file is missing from storage." }, 404)

  ctx.waitUntil(record(env, license, file, access.status, domain, now, true).catch((e) => console.error("Warden: could not log download:", e)))
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

async function record(env: Env, license: License, file: LicenseFile, status: string, domain: string | null, now: number, ok: boolean) {
  const statements = [
    env.DB.prepare("INSERT INTO activity (license_id, at, kind, status, domain, detail) VALUES (?, ?, 'download', ?, ?, ?)").bind(
      license.id, now, status, domain, `${ok ? "Downloaded" : "Download refused"}: ${file.name} (${KIND_LABEL[file.kind].toLowerCase()})`
    ),
  ]
  if (ok) statements.push(env.DB.prepare("UPDATE files SET download_count = download_count + 1, last_download_at = ? WHERE id = ?").bind(now, file.id))
  await env.DB.batch(statements)
}
