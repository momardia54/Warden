import { cleanFileName, isFileKind, MAX_FILE_BYTES, type FileKind } from "../lib/files"
import { newId } from "./util.server"
import type { License } from "./licenses.server"

export type LicenseFile = {
  id: string
  license_id: string
  name: string
  kind: FileKind
  version: string
  notes: string
  size: number
  content_type: string
  r2_key: string
  uploaded_at: number
  download_count: number
  last_download_at: number | null
}

export function storageConfigured(env: Env): boolean {
  return Boolean(env.FILES)
}

export async function listFiles(env: Env, licenseId: string): Promise<LicenseFile[]> {
  return (await env.DB.prepare("SELECT * FROM files WHERE license_id = ? ORDER BY uploaded_at DESC, id DESC").bind(licenseId).all<LicenseFile>()).results
}

export function getFile(env: Env, licenseId: string, fileId: string): Promise<LicenseFile | null> {
  return env.DB.prepare("SELECT * FROM files WHERE id = ? AND license_id = ?").bind(fileId, licenseId).first<LicenseFile>()
}

export type StoreInput = { name: string; kind: string; version?: string; notes?: string; contentType?: string | null; size: number; body: ReadableStream | null }

/** Validates, streams the body into R2 and records the file. Returns the file or an error message. */
export async function storeFile(env: Env, license: License, input: StoreInput): Promise<{ file: LicenseFile } | { error: string; status: number }> {
  if (!storageConfigured(env)) return { error: "File storage (R2) is not set up on this install.", status: 501 }
  const name = cleanFileName(input.name)
  if (!name) return { error: "Give the file a name (the name query parameter or field).", status: 422 }
  if (!isFileKind(input.kind)) return { error: 'kind must be "update" or "final".', status: 422 }
  if (!Number.isFinite(input.size) || input.size <= 0) return { error: "The upload is empty, or has no Content-Length.", status: 411 }
  if (input.size > MAX_FILE_BYTES) return { error: `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`, status: 413 }
  if (!input.body) return { error: "The upload has no body.", status: 422 }

  const id = newId("fil")
  const key = `${license.id}/${id}`
  const contentType = (input.contentType || "application/octet-stream").slice(0, 120)
  await env.FILES.put(key, input.body, { httpMetadata: { contentType } })
  const now = Date.now()
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO files (id, license_id, name, kind, version, notes, size, content_type, r2_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        id, license.id, name, input.kind, (input.version ?? "").trim().slice(0, 40), (input.notes ?? "").trim().slice(0, 500), input.size, contentType, key, now
      ),
      env.DB.prepare("INSERT INTO activity (license_id, at, kind, status, detail) VALUES (?, ?, 'change', ?, ?)").bind(license.id, now, license.status, `File added: ${name} (${input.kind})`),
    ])
  } catch (error) {
    await env.FILES.delete(key)
    throw error
  }
  return { file: (await getFile(env, license.id, id))! }
}

export async function deleteFile(env: Env, license: License, file: LicenseFile): Promise<void> {
  if (storageConfigured(env)) await env.FILES.delete(file.r2_key)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id),
    env.DB.prepare("INSERT INTO activity (license_id, at, kind, status, detail) VALUES (?, ?, 'change', ?, ?)").bind(license.id, Date.now(), license.status, `File removed: ${file.name} (${file.kind})`),
  ])
}

/** Removes every stored object of a licence. Called before the licence rows are deleted. */
export async function deleteLicenseFiles(env: Env, licenseId: string): Promise<void> {
  if (!storageConfigured(env)) return
  const keys = (await listFiles(env, licenseId)).map((f) => f.r2_key)
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000))
}
