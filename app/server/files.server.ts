import { cleanFileName, defaultReleaseStatuses, MAX_FILE_BYTES } from "../lib/files"
import { CHANNELS, isChannel, isValidVersion, MAX_CHANGELOG_LENGTH, MAX_VERSION_LENGTH, type Channel } from "../lib/releases"
import { describeStatusKeys, parseStatusKeys, splitStatusKeys, type StatusSet } from "../lib/statuses"
import type { App } from "./apps.server"
import type { License } from "./licenses.server"
import { getStatusSetForApp, getStatusSetForLicense } from "./statuses.server"
import { newId, toHex } from "./util.server"

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
  /** Empty for an attachment. A file with a version is a release. */
  version: string
  /** Internal notes, never sent to sites. */
  notes: string
  /** stable or beta. */
  channel: Channel
  /** Public release notes. */
  changelog: string
  /** Hex SHA-256 of the stored file. Empty for files uploaded before checksums were recorded. */
  sha256: string
  /** Set when the release was withdrawn: no longer offered or downloadable. */
  withdrawn_at: number | null
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

/** The statuses a file's release rule refers to: those of its licence (own, app's or default), or of its app. */
export const statusSetForOwner = (env: Env, owner: FileOwner): Promise<StatusSet> => ("license" in owner ? getStatusSetForLicense(env, owner.license) : getStatusSetForApp(env, owner.app.id))

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
  channel?: string
  changelog?: string
  contentType?: string | null
  size: number
  body: ReadableStream | null
}

type Failure = { error: string; status: number }

/** Validates an optional version. Returns the cleaned value ("" for none) or an error message. */
function readVersion(raw: string | undefined): { version: string } | { error: string } {
  const version = (raw ?? "").trim()
  if (version && !isValidVersion(version)) {
    return { error: `"${version.slice(0, MAX_VERSION_LENGTH)}" is not a valid version. Use numbers separated by dots, optionally with a suffix, for example 1.4.0 or 2.0.0-beta.1.` }
  }
  return { version }
}

function readChannel(raw: string | undefined): { channel: Channel } | { error: string } {
  const channel = (raw ?? "").trim().toLowerCase() || "stable"
  return isChannel(channel) ? { channel } : { error: `channel must be one of: ${CHANNELS.join(", ")}.` }
}

/** Feeds bytes to SHA-256 as they pass. Workers have a streaming digest; elsewhere (tests) the bytes are collected first. */
function sha256Hasher(): { update: (chunk: Uint8Array) => Promise<void>; digest: () => Promise<string> } {
  const Native = (crypto as unknown as { DigestStream?: new (algorithm: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } }).DigestStream
  if (typeof Native === "function") {
    const stream = new Native("SHA-256")
    const writer = stream.getWriter()
    return {
      update: (chunk) => writer.write(chunk),
      digest: async () => {
        await writer.close()
        return toHex(await stream.digest)
      },
    }
  }
  const chunks: Uint8Array[] = []
  return {
    update: async (chunk) => void chunks.push(chunk),
    digest: async () => toHex(await crypto.subtle.digest("SHA-256", await new Blob(chunks as BlobPart[]).arrayBuffer())),
  }
}

/**
 * Streams the body through a SHA-256 hash. In a Worker the result is wrapped in a FixedLengthStream, because R2 needs to
 * know the length of a stream in advance; it also fails the upload if fewer or more bytes arrive than announced.
 */
function hashedBody(body: ReadableStream<Uint8Array>, size: number): { stream: ReadableStream; digest: () => Promise<string> } {
  const hasher = sha256Hasher()
  const hashed = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        await hasher.update(chunk)
        controller.enqueue(chunk)
      },
    })
  )
  const stream = typeof FixedLengthStream === "function" ? hashed.pipeThrough(new FixedLengthStream(size)) : hashed
  return { stream, digest: hasher.digest }
}

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
  const version = readVersion(input.version)
  if ("error" in version) return { error: version.error, status: 422 }
  const channel = readChannel(input.channel)
  if ("error" in channel) return { error: channel.error, status: 422 }

  const id = newId("fil")
  const key = `${ownerId(owner)}/${id}`
  const contentType = (input.contentType || "application/octet-stream").slice(0, 120)
  const body = hashedBody(input.body, input.size)
  await env.FILES.put(key, body.stream, { httpMetadata: { contentType } })
  const sha256 = await body.digest()
  const now = Date.now()
  const label = version.version ? `${name} (version ${version.version}${channel.channel === "beta" ? ", beta" : ""})` : name
  try {
    const statements = [
      env.DB.prepare(
        `INSERT INTO files (id, license_id, app_id, name, version, notes, channel, changelog, sha256, statuses, check_domain, size, content_type, r2_key, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, "license" in owner ? owner.license.id : null, "app" in owner ? owner.app.id : null, name, version.version, (input.notes ?? "").trim().slice(0, 500),
        channel.channel, (input.changelog ?? "").trim().slice(0, MAX_CHANGELOG_LENGTH), sha256, statuses.join(","), input.checkDomain === false ? 0 : 1, input.size, contentType, key, now
      ),
    ]
    if ("license" in owner) statements.push(logChange(env, owner.license, now, `File added: ${label} (available when ${describeStatusKeys(statuses, set)})`))
    await env.DB.batch(statements)
  } catch (error) {
    await env.FILES.delete(key)
    throw error
  }
  return { file: (await getFile(env, owner, id))! }
}

export type FileChanges = {
  statuses?: unknown
  checkDomain?: boolean
  version?: string
  notes?: string
  channel?: string
  changelog?: string
  /** true withdraws the release, false restores it. */
  withdrawn?: boolean
}

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
  const version = changes.version === undefined ? { version: file.version } : readVersion(changes.version)
  if ("error" in version) return { error: version.error, status: 422 }
  const channel = changes.channel === undefined ? { channel: file.channel } : readChannel(changes.channel)
  if ("error" in channel) return { error: channel.error, status: 422 }
  const withdrawnAt = changes.withdrawn === undefined ? file.withdrawn_at : changes.withdrawn ? (file.withdrawn_at ?? Date.now()) : null
  const notes = changes.notes === undefined ? file.notes : changes.notes.trim().slice(0, 500)
  const changelog = changes.changelog === undefined ? file.changelog : changes.changelog.trim().slice(0, MAX_CHANGELOG_LENGTH)
  const statements = [
    env.DB.prepare("UPDATE files SET statuses = ?, check_domain = ?, version = ?, notes = ?, channel = ?, changelog = ?, withdrawn_at = ? WHERE id = ?").bind(
      statuses, checkDomain, version.version, notes, channel.channel, changelog, withdrawnAt, file.id
    ),
  ]
  if ("license" in owner) {
    const now = Date.now()
    if (statuses !== file.statuses || checkDomain !== file.check_domain) {
      statements.push(logChange(env, owner.license, now, `File updated: ${file.name} (available when ${describeStatusKeys(splitStatusKeys(statuses, set), set)})`))
    }
    if ((withdrawnAt === null) !== (file.withdrawn_at === null)) statements.push(logChange(env, owner.license, now, `${withdrawnAt === null ? "Release restored" : "Release withdrawn"}: ${file.name}`))
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

/** Reads the file fields a dashboard form sent. Fields that are absent are left unchanged. */
function readFileForm(form: FormData): FileChanges {
  const text = (name: string) => (form.has(name) ? String(form.get(name)) : undefined)
  const flag = (name: string) => (form.has(name) ? form.get(name) === "true" : undefined)
  return { statuses: text("statuses"), checkDomain: flag("check_domain"), version: text("version"), notes: text("notes"), channel: text("channel"), changelog: text("changelog"), withdrawn: flag("withdrawn") }
}

/**
 * Handles the file intents of a licence or app page: "update-file" and "delete-file". Returns `{ ok: true }` or
 * `{ error }` for the page's fetcher, or null when the intent is not a file intent.
 */
export async function applyFileForm(env: Env, owner: FileOwner, form: FormData): Promise<{ ok: true } | { error: string } | null> {
  const intent = String(form.get("intent"))
  if (intent !== "update-file" && intent !== "delete-file") return null
  const file = await getFile(env, owner, String(form.get("fileId")))
  if (!file) return { error: "That file no longer exists. Reload the page." }
  if (intent === "delete-file") {
    await deleteFile(env, owner, file)
    return { ok: true }
  }
  const updated = await updateFile(env, owner, file, readFileForm(form))
  return "error" in updated ? { error: updated.error } : { ok: true }
}
