import { cleanFileName, DEFAULT_RELEASE_STATUSES, describeStatuses, MAX_FILE_BYTES, parseStatuses, splitStatuses } from "../lib/files"
import type { Status } from "../lib/license"
import { newId } from "./util.server"
import type { License } from "./licenses.server"

/** A file row as stored. `statuses` is a comma separated list; use `releaseRule` for the parsed form. */
export type LicenseFile = {
  id: string
  license_id: string
  name: string
  version: string
  notes: string
  statuses: string
  check_domain: number
  size: number
  content_type: string
  r2_key: string
  uploaded_at: number
  download_count: number
  last_download_at: number | null
}

export const releaseRule = (f: Pick<LicenseFile, "statuses" | "check_domain">): { statuses: Status[]; check_domain: boolean } => ({
  statuses: splitStatuses(f.statuses),
  check_domain: f.check_domain === 1,
})

export function storageConfigured(env: Env): boolean {
  return Boolean(env.FILES)
}

export async function listFiles(env: Env, licenseId: string): Promise<LicenseFile[]> {
  return (await env.DB.prepare("SELECT * FROM files WHERE license_id = ? ORDER BY uploaded_at DESC, id DESC").bind(licenseId).all<LicenseFile>()).results
}

export function getFile(env: Env, licenseId: string, fileId: string): Promise<LicenseFile | null> {
  return env.DB.prepare("SELECT * FROM files WHERE id = ? AND license_id = ?").bind(fileId, licenseId).first<LicenseFile>()
}

export type StoreInput = {
  name: string
  /** Statuses the file is released in, as a comma separated string or an array. Defaults to active and completed. */
  statuses?: unknown
  /** Require the requesting site's domain to match the licence's domains. Defaults to true. */
  checkDomain?: boolean
  version?: string
  notes?: string
  contentType?: string | null
  size: number
  body: ReadableStream | null
}

type Failure = { error: string; status: number }

/** Validates the input, streams the body to R2 and records the file. */
export async function storeFile(env: Env, license: License, input: StoreInput): Promise<{ file: LicenseFile } | Failure> {
  if (!storageConfigured(env)) return { error: "File storage (R2) is not configured for this deployment.", status: 501 }
  const name = cleanFileName(input.name)
  if (!name) return { error: "A file name is required.", status: 422 }
  const statuses = input.statuses === undefined || input.statuses === "" ? DEFAULT_RELEASE_STATUSES : parseStatuses(input.statuses)
  if (!statuses) return { error: "statuses must be a comma separated list of valid licence statuses.", status: 422 }
  if (!Number.isFinite(input.size) || input.size <= 0) return { error: "The request body is empty or has no Content-Length header.", status: 411 }
  if (input.size > MAX_FILE_BYTES) return { error: `The file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`, status: 413 }
  if (!input.body) return { error: "The request has no body.", status: 422 }

  const id = newId("fil")
  const key = `${license.id}/${id}`
  const contentType = (input.contentType || "application/octet-stream").slice(0, 120)
  await env.FILES.put(key, input.body, { httpMetadata: { contentType } })
  const now = Date.now()
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO files (id, license_id, name, version, notes, statuses, check_domain, size, content_type, r2_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, license.id, name, (input.version ?? "").trim().slice(0, 40), (input.notes ?? "").trim().slice(0, 500), statuses.join(","), input.checkDomain === false ? 0 : 1, input.size, contentType, key, now),
      logChange(env, license, now, `File added: ${name} (available when ${describeStatuses(statuses)})`),
    ])
  } catch (error) {
    await env.FILES.delete(key)
    throw error
  }
  return { file: (await getFile(env, license.id, id))! }
}

export type FileChanges = { statuses?: unknown; checkDomain?: boolean; version?: string; notes?: string }

/** Updates a file's release rule or metadata. Only the fields present are changed. */
export async function updateFile(env: Env, license: License, file: LicenseFile, changes: FileChanges): Promise<{ file: LicenseFile } | Failure> {
  let statuses = file.statuses
  if (changes.statuses !== undefined) {
    const parsed = parseStatuses(changes.statuses)
    if (!parsed) return { error: "statuses must be a comma separated list of valid licence statuses.", status: 422 }
    statuses = parsed.join(",")
  }
  const checkDomain = changes.checkDomain === undefined ? file.check_domain : changes.checkDomain ? 1 : 0
  const version = changes.version === undefined ? file.version : changes.version.trim().slice(0, 40)
  const notes = changes.notes === undefined ? file.notes : changes.notes.trim().slice(0, 500)
  const statements = [env.DB.prepare("UPDATE files SET statuses = ?, check_domain = ?, version = ?, notes = ? WHERE id = ?").bind(statuses, checkDomain, version, notes, file.id)]
  if (statuses !== file.statuses || checkDomain !== file.check_domain) {
    statements.push(logChange(env, license, Date.now(), `File updated: ${file.name} (available when ${describeStatuses(splitStatuses(statuses))})`))
  }
  await env.DB.batch(statements)
  return { file: (await getFile(env, license.id, file.id))! }
}

export async function deleteFile(env: Env, license: License, file: LicenseFile): Promise<void> {
  if (storageConfigured(env)) await env.FILES.delete(file.r2_key)
  await env.DB.batch([env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id), logChange(env, license, Date.now(), `File removed: ${file.name}`)])
}

/** Deletes every stored object of a licence. Called before the licence rows are removed. */
export async function deleteLicenseFiles(env: Env, licenseId: string): Promise<void> {
  if (!storageConfigured(env)) return
  const keys = (await listFiles(env, licenseId)).map((f) => f.r2_key)
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000))
}

function logChange(env: Env, license: License, at: number, detail: string) {
  return env.DB.prepare("INSERT INTO activity (license_id, at, event, status, detail) VALUES (?, ?, 'change', ?, ?)").bind(license.id, at, license.status, detail)
}
