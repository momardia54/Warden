import { cleanFileName, defaultReleaseStatuses, MAX_FILE_BYTES } from "../lib/files"
import { describeStatusKeys, parseStatusKeys, splitStatusKeys, type StatusSet } from "../lib/statuses"
import type { App } from "./apps.server"
import type { License } from "./licenses.server"
import { getStatusSet } from "./statuses.server"
import { newId } from "./util.server"

/** The owner of a file: a single licence, or an app (shared by every licence of that app). */
export type FileOwner = { license: License } | { app: App }

const ownerId = (owner: FileOwner) => ("license" in owner ? owner.license.id : owner.app.id)
const ownerColumn = (owner: FileOwner) => ("license" in owner ? "license_id" : "app_id")

/** A file row as stored. `statuses` is a comma separated list of status keys; use `releaseRule` for the parsed form. */
export type LicenseFile = {
  id: string
  /** Set for a file that belongs to one licence. */
  license_id: string | null
  /** Set for a file shared by all licences of an app. */
  app_id: string | null
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

/** The release rule of a file, with the statuses read against the status set that applies to its owner. */
export const releaseRule = (f: Pick<LicenseFile, "statuses" | "check_domain">, set: StatusSet): { statuses: string[]; check_domain: boolean } => ({
  statuses: splitStatusKeys(f.statuses, set),
  check_domain: f.check_domain === 1,
})

/** The status set that applies to the files of an owner: the app's own set if it has one, otherwise the default set. */
export const statusSetForOwner = (env: Env, owner: FileOwner): Promise<StatusSet> => getStatusSet(env, "license" in owner ? owner.license.app_id : owner.app.id)

export function storageConfigured(env: Env): boolean {
  return Boolean(env.FILES)
}

/** The files owned directly by a licence or an app. */
export async function listFiles(env: Env, owner: FileOwner): Promise<LicenseFile[]> {
  return (await env.DB.prepare(`SELECT * FROM files WHERE ${ownerColumn(owner)} = ? ORDER BY uploaded_at DESC, id DESC`).bind(ownerId(owner)).all<LicenseFile>()).results
}

export function getFile(env: Env, owner: FileOwner, fileId: string): Promise<LicenseFile | null> {
  return env.DB.prepare(`SELECT * FROM files WHERE id = ? AND ${ownerColumn(owner)} = ?`).bind(fileId, ownerId(owner)).first<LicenseFile>()
}

/** Every file a licence can see: its own files and the files of its app. */
export async function listFilesForLicense(env: Env, license: License): Promise<LicenseFile[]> {
  return (
    await env.DB.prepare("SELECT * FROM files WHERE license_id = ? OR app_id = ? ORDER BY uploaded_at DESC, id DESC").bind(license.id, license.app_id).all<LicenseFile>()
  ).results
}

export function getFileForLicense(env: Env, license: License, fileId: string): Promise<LicenseFile | null> {
  return env.DB.prepare("SELECT * FROM files WHERE id = ? AND (license_id = ? OR app_id = ?)").bind(fileId, license.id, license.app_id).first<LicenseFile>()
}

export type StoreInput = {
  name: string
  /** Statuses the file is released in, as a comma separated string or an array of status keys. Defaults to the statuses that grant access. */
  statuses?: unknown
  /** Require the requesting site's domain to be allowed for the licence. Defaults to true. */
  checkDomain?: boolean
  version?: string
  notes?: string
  contentType?: string | null
  size: number
  body: ReadableStream | null
}

type Failure = { error: string; status: number }

/** Validates the input, streams the body to R2 and records the file. */
export async function storeFile(env: Env, owner: FileOwner, input: StoreInput): Promise<{ file: LicenseFile } | Failure> {
  if (!storageConfigured(env)) return { error: "File storage (R2) is not configured for this deployment.", status: 501 }
  const name = cleanFileName(input.name)
  if (!name) return { error: "A file name is required.", status: 422 }
  const set = await statusSetForOwner(env, owner)
  const statuses = input.statuses === undefined || input.statuses === "" ? defaultReleaseStatuses(set) : parseStatusKeys(input.statuses, set)
  if (!statuses) return { error: `statuses must be a comma separated list of licence statuses: ${set.map((s) => s.key).join(", ")}.`, status: 422 }
  if (!Number.isFinite(input.size) || input.size <= 0) return { error: "The request body is empty or has no Content-Length header.", status: 411 }
  if (input.size > MAX_FILE_BYTES) return { error: `The file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`, status: 413 }
  if (!input.body) return { error: "The request has no body.", status: 422 }

  const id = newId("fil")
  const key = `${ownerId(owner)}/${id}`
  const contentType = (input.contentType || "application/octet-stream").slice(0, 120)
  await env.FILES.put(key, input.body, { httpMetadata: { contentType } })
  const now = Date.now()
  try {
    const statements = [
      env.DB.prepare(
        `INSERT INTO files (id, license_id, app_id, name, version, notes, statuses, check_domain, size, content_type, r2_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, "license" in owner ? owner.license.id : null, "app" in owner ? owner.app.id : null, name, (input.version ?? "").trim().slice(0, 40), (input.notes ?? "").trim().slice(0, 500),
        statuses.join(","), input.checkDomain === false ? 0 : 1, input.size, contentType, key, now
      ),
    ]
    if ("license" in owner) statements.push(logChange(env, owner.license, now, `File added: ${name} (available when ${describeStatusKeys(statuses, set)})`))
    await env.DB.batch(statements)
  } catch (error) {
    await env.FILES.delete(key)
    throw error
  }
  return { file: (await getFile(env, owner, id))! }
}

export type FileChanges = { statuses?: unknown; checkDomain?: boolean; version?: string; notes?: string }

/** Updates a file's release rule or metadata. Only the fields present are changed. */
export async function updateFile(env: Env, owner: FileOwner, file: LicenseFile, changes: FileChanges): Promise<{ file: LicenseFile } | Failure> {
  const set = await statusSetForOwner(env, owner)
  let statuses = file.statuses
  if (changes.statuses !== undefined) {
    const parsed = parseStatusKeys(changes.statuses, set)
    if (!parsed) return { error: `statuses must be a comma separated list of licence statuses: ${set.map((s) => s.key).join(", ")}.`, status: 422 }
    statuses = parsed.join(",")
  }
  const checkDomain = changes.checkDomain === undefined ? file.check_domain : changes.checkDomain ? 1 : 0
  const version = changes.version === undefined ? file.version : changes.version.trim().slice(0, 40)
  const notes = changes.notes === undefined ? file.notes : changes.notes.trim().slice(0, 500)
  const statements = [env.DB.prepare("UPDATE files SET statuses = ?, check_domain = ?, version = ?, notes = ? WHERE id = ?").bind(statuses, checkDomain, version, notes, file.id)]
  if ("license" in owner && (statuses !== file.statuses || checkDomain !== file.check_domain)) {
    statements.push(logChange(env, owner.license, Date.now(), `File updated: ${file.name} (available when ${describeStatusKeys(splitStatusKeys(statuses, set), set)})`))
  }
  await env.DB.batch(statements)
  return { file: (await getFile(env, owner, file.id))! }
}

export async function deleteFile(env: Env, owner: FileOwner, file: LicenseFile): Promise<void> {
  if (storageConfigured(env)) await env.FILES.delete(file.r2_key)
  const statements = [env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id)]
  if ("license" in owner) statements.push(logChange(env, owner.license, Date.now(), `File removed: ${file.name}`))
  await env.DB.batch(statements)
}

async function deleteStoredObjects(env: Env, column: "license_id" | "app_id", id: string): Promise<void> {
  if (!storageConfigured(env)) return
  const rows = (await env.DB.prepare(`SELECT r2_key FROM files WHERE ${column} = ?`).bind(id).all<{ r2_key: string }>()).results
  const keys = rows.map((r) => r.r2_key)
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000))
}

/** Deletes the stored objects of a licence. Called before the licence rows are removed. */
export const deleteLicenseFiles = (env: Env, licenseId: string) => deleteStoredObjects(env, "license_id", licenseId)

/** Deletes the stored objects of an app. Called before the app rows are removed. */
export const deleteAppFiles = (env: Env, appId: string) => deleteStoredObjects(env, "app_id", appId)

function logChange(env: Env, license: License, at: number, detail: string) {
  return env.DB.prepare("INSERT INTO activity (license_id, at, event, status, detail) VALUES (?, ?, 'change', ?, ?)").bind(license.id, at, license.status, detail)
}
