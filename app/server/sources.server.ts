import { defaultReleaseStatuses, MAX_FILE_BYTES } from "../lib/files"
import { generateSecret } from "../lib/random"
import {
  channelForVersion,
  IMPORT_TIMEOUT_MS,
  isProvider,
  isTrigger,
  packageFileName,
  packageFolderError,
  parseRepository,
  PROVIDER_INFO,
  PROVIDERS,
  TRIGGERS,
  versionFromTag,
  type ImportState,
  type ProviderKey,
  type TriggerKey,
} from "../lib/sources"
import { parseStatusKeys, splitStatusKeys } from "../lib/statuses"
import { partsStream, repackZip, ZipError } from "../lib/zip"
import { readTextUpTo } from "./api-http.server"
import { getApp } from "./apps.server"
import { statusSetForOwner, storeFile, type FileOwner } from "./files.server"
import { getLicense } from "./licenses.server"
import { github } from "./source-providers/github.server"
import type { ProviderFailure, SourceProvider } from "./source-providers/types"
import { json, newId } from "./util.server"

/** The implementation of each provider listed in app/lib/sources.ts. */
const PROVIDER_IMPLEMENTATIONS: Record<ProviderKey, SourceProvider> = {
  github,
}

export type ReleaseSource = {
  id: string
  app_id: string | null
  license_id: string | null
  provider: ProviderKey
  repository: string
  trigger: TriggerKey
  package_folder: string
  statuses: string
  check_domain: number
  /** Access token for a private repository. Never sent to the dashboard or the API. */
  token: string
  webhook_secret: string
  options: string
  enabled: number
  created_at: number
  updated_at: number
  last_delivery_at: number | null
}

export type SourceImport = {
  id: string
  source_id: string
  ref: string
  commit_sha: string
  version: string
  state: ImportState
  detail: string
  file_id: string | null
  started_at: number
  finished_at: number | null
}

/** A source as the dashboard and the API show it: without the token, with the webhook address. */
export type PublicSource = Omit<ReleaseSource, "token" | "options" | "enabled" | "check_domain"> & {
  has_token: boolean
  enabled: boolean
  check_domain: boolean
  status_keys: string[]
  webhook_url: string
}

type Failure = { error: string; status: number }

const ownerColumn = (owner: FileOwner) => ("license" in owner ? "license_id" : "app_id")
const ownerId = (owner: FileOwner) => ("license" in owner ? owner.license.id : owner.app.id)

export function getSource(env: Env, owner: FileOwner): Promise<ReleaseSource | null> {
  return env.DB.prepare(`SELECT * FROM release_sources WHERE ${ownerColumn(owner)} = ?`)
    .bind(ownerId(owner))
    .first<ReleaseSource>()
}

export function getSourceById(env: Env, id: string): Promise<ReleaseSource | null> {
  return env.DB.prepare("SELECT * FROM release_sources WHERE id = ?").bind(id).first<ReleaseSource>()
}

export async function publicSource(env: Env, source: ReleaseSource, origin: string): Promise<PublicSource> {
  const { token, options: _options, ...rest } = source
  const owner = await ownerOf(env, source)
  return {
    ...rest,
    has_token: token !== "",
    enabled: source.enabled === 1,
    check_domain: source.check_domain === 1,
    status_keys: owner ? splitStatusKeys(source.statuses, await statusSetForOwner(env, owner)) : source.statuses.split(",").filter(Boolean),
    webhook_url: `${origin}/hooks/${source.provider}/${source.id}`,
  }
}

async function ownerOf(env: Env, source: ReleaseSource): Promise<FileOwner | null> {
  if (source.app_id) {
    const app = await getApp(env, source.app_id)
    return app ? { app } : null
  }
  const license = source.license_id ? await getLicense(env, source.license_id) : null
  return license ? { license } : null
}

/** Fields accepted when connecting or editing a source. Absent fields keep their current value. */
export type SourceInput = {
  provider?: unknown
  repository?: unknown
  trigger?: unknown
  package_folder?: unknown
  statuses?: unknown
  check_domain?: unknown
  /** A new token; "" removes it; absent keeps the current one. */
  token?: unknown
  enabled?: unknown
}

/**
 * Connects a repository to an app or licence, or changes the connected one. The repository is checked with the
 * provider first, so a typo or a token without access is reported now rather than on the first tag.
 */
export async function saveSource(env: Env, owner: FileOwner, input: SourceInput, now = Date.now()): Promise<{ source: ReleaseSource; created: boolean } | Failure> {
  const current = await getSource(env, owner)
  const provider = input.provider === undefined ? (current?.provider ?? "github") : input.provider
  if (!isProvider(provider))
    return {
      error: `provider must be one of: ${PROVIDERS.join(", ")}.`,
      status: 422,
    }
  const trigger = input.trigger === undefined ? (current?.trigger ?? "tag") : input.trigger
  if (!isTrigger(trigger))
    return {
      error: `trigger must be one of: ${TRIGGERS.join(", ")}.`,
      status: 422,
    }

  const rawRepository = input.repository === undefined ? current?.repository : input.repository
  const repository = typeof rawRepository === "string" ? parseRepository(provider, rawRepository) : null
  if (!repository)
    return {
      error: `Enter the repository as ${PROVIDER_INFO[provider].repositoryHint}.`,
      status: 422,
    }

  const rawFolder = input.package_folder === undefined || input.package_folder === "" ? (current?.package_folder ?? repository.split("/")[1]) : input.package_folder
  const folder = typeof rawFolder === "string" ? rawFolder.trim() : ""
  const folderError = packageFolderError(folder)
  if (folderError) return { error: folderError, status: 422 }

  const set = await statusSetForOwner(env, owner)
  const statuses = input.statuses === undefined || input.statuses === "" ? (current ? splitStatusKeys(current.statuses, set) : defaultReleaseStatuses(set)) : parseStatusKeys(input.statuses, set)
  if (!statuses || statuses.length === 0)
    return {
      error: `statuses must be a comma separated list of licence statuses: ${set.map((s) => s.key).join(", ")}.`,
      status: 422,
    }

  if (input.check_domain !== undefined && typeof input.check_domain !== "boolean") return { error: "check_domain must be true or false.", status: 422 }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") return { error: "enabled must be true or false.", status: 422 }
  if (input.token !== undefined && typeof input.token !== "string") return { error: "token must be a string.", status: 422 }
  const token = input.token === undefined ? (current?.token ?? "") : (input.token as string).trim()
  if (token.length > 500 || /\s/.test(token)) return { error: "The access token is not valid.", status: 422 }
  const checkDomain = input.check_domain === undefined ? (current?.check_domain ?? 1) : input.check_domain ? 1 : 0
  const enabled = input.enabled === undefined ? (current?.enabled ?? 1) : input.enabled ? 1 : 0

  // Check access only when what is checked changed: the repository, the provider or the token.
  if (!current || current.repository !== repository || current.provider !== provider || current.token !== token) {
    const access = await PROVIDER_IMPLEMENTATIONS[provider].checkAccess({
      repository,
      token,
      webhook_secret: "",
    })
    if ("error" in access) return { error: access.error, status: 422 }
  }

  if (current) {
    await env.DB.prepare(
      "UPDATE release_sources SET provider = ?, repository = ?, trigger = ?, package_folder = ?, statuses = ?, check_domain = ?, token = ?, enabled = ?, updated_at = ? WHERE id = ?",
    )
      .bind(provider, repository, trigger, folder, statuses.join(","), checkDomain, token, enabled, now, current.id)
      .run()
    return { source: (await getSourceById(env, current.id))!, created: false }
  }
  const id = newId("src")
  await env.DB.prepare(
    `INSERT INTO release_sources (id, app_id, license_id, provider, repository, trigger, package_folder, statuses, check_domain, token, webhook_secret, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      "app" in owner ? owner.app.id : null,
      "license" in owner ? owner.license.id : null,
      provider,
      repository,
      trigger,
      folder,
      statuses.join(","),
      checkDomain,
      token,
      generateSecret(40),
      enabled,
      now,
      now,
    )
    .run()
  return { source: (await getSourceById(env, id))!, created: true }
}

export async function regenerateWebhookSecret(env: Env, source: ReleaseSource): Promise<void> {
  await env.DB.prepare("UPDATE release_sources SET webhook_secret = ?, updated_at = ? WHERE id = ?").bind(generateSecret(40), Date.now(), source.id).run()
}

/** Disconnects the repository. Releases it already published stay. */
export async function deleteSource(env: Env, source: ReleaseSource): Promise<void> {
  await env.DB.batch([env.DB.prepare("DELETE FROM source_imports WHERE source_id = ?").bind(source.id), env.DB.prepare("DELETE FROM release_sources WHERE id = ?").bind(source.id)])
}

const timedOut = (row: SourceImport, now: number) => row.state === "pending" && now - row.started_at > IMPORT_TIMEOUT_MS
const TIMEOUT_DETAIL = "The import did not finish. Retry it."

/** The latest imports of a source, newest first. Imports pending for too long are reported as failed. */
export async function listImports(env: Env, sourceId: string, limit = 20, now = Date.now()): Promise<SourceImport[]> {
  const rows = (await env.DB.prepare("SELECT * FROM source_imports WHERE source_id = ? ORDER BY started_at DESC, id DESC LIMIT ?").bind(sourceId, limit).all<SourceImport>()).results
  return rows.map((row) => (timedOut(row, now) ? { ...row, state: "failed", detail: TIMEOUT_DETAIL } : row))
}

export function getImport(env: Env, sourceId: string, importId: string): Promise<SourceImport | null> {
  return env.DB.prepare("SELECT * FROM source_imports WHERE id = ? AND source_id = ?").bind(importId, sourceId).first<SourceImport>()
}

/** Marks imports that never finished as failed. Run by the daily cron. */
export async function pruneImports(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("UPDATE source_imports SET state = 'failed', detail = ?, finished_at = ? WHERE state = 'pending' AND started_at < ?")
    .bind(TIMEOUT_DETAIL, now, now - IMPORT_TIMEOUT_MS)
    .run()
}

async function finish(env: Env, id: string, state: ImportState, detail: string, fileId: string | null = null): Promise<void> {
  await env.DB.prepare("UPDATE source_imports SET state = ?, detail = ?, file_id = ?, finished_at = ? WHERE id = ?").bind(state, detail.slice(0, 500), fileId, Date.now(), id).run()
}

/**
 * Records a tag to publish and starts publishing it in the background. A tag that was already published, skipped or
 * is in progress is left as it is, so repeated deliveries publish once; a failed one is tried again.
 */
export async function startImport(env: Env, ctx: ExecutionContext, source: ReleaseSource, tag: string, commit = "", now = Date.now()): Promise<SourceImport> {
  const ref = tag.trim().slice(0, 200)
  const version = versionFromTag(ref) ?? ""
  const inserted = await env.DB.prepare(
    "INSERT INTO source_imports (id, source_id, ref, commit_sha, version, state, started_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT (source_id, ref) DO NOTHING RETURNING id",
  )
    .bind(newId("imp"), source.id, ref, commit, version, now)
    .first<{ id: string }>()
  let id = inserted?.id
  if (!id) {
    const existing = (await env.DB.prepare("SELECT * FROM source_imports WHERE source_id = ? AND ref = ?").bind(source.id, ref).first<SourceImport>())!
    if (existing.state !== "failed" && !timedOut(existing, now)) return existing
    await env.DB.prepare("UPDATE source_imports SET state = 'pending', detail = '', commit_sha = ?, version = ?, file_id = NULL, started_at = ?, finished_at = NULL WHERE id = ?")
      .bind(commit || existing.commit_sha, version, now, existing.id)
      .run()
    id = existing.id
  }
  if (!version) {
    await finish(env, id, "skipped", `"${ref}" is not a version, so nothing was published. Name release tags like v1.4.0.`)
  } else {
    ctx.waitUntil(runImport(env, source, id).catch((error) => console.error("Release import failed:", error)))
  }
  return (await env.DB.prepare("SELECT * FROM source_imports WHERE id = ?").bind(id).first<SourceImport>())!
}

/** Tries an import again: after a failure, or after a skip once the reason was fixed (for example a deleted release). */
export async function retryImport(env: Env, ctx: ExecutionContext, source: ReleaseSource, row: SourceImport, now = Date.now()): Promise<SourceImport | Failure> {
  if (row.state === "pending" && !timedOut(row, now)) return { error: "This import is still in progress.", status: 409 }
  if (row.state === "imported")
    return {
      error: "This tag is already published. Delete the release first to publish it again.",
      status: 409,
    }
  await env.DB.prepare("UPDATE source_imports SET state = 'failed' WHERE id = ?").bind(row.id).run()
  return startImport(env, ctx, source, row.ref, row.commit_sha, now)
}

/** Downloads, repacks and publishes one tag. Records the outcome on the import; never throws. */
export async function runImport(env: Env, source: ReleaseSource, importId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM source_imports WHERE id = ?").bind(importId).first<SourceImport>()
  if (!row) return
  try {
    const owner = await ownerOf(env, source)
    if (!owner) return finish(env, row.id, "failed", "The app or licence of this source no longer exists.")
    const duplicate = await env.DB.prepare(`SELECT name FROM files WHERE ${ownerColumn(owner)} = ? AND version = ? AND withdrawn_at IS NULL LIMIT 1`)
      .bind(ownerId(owner), row.version)
      .first<{ name: string }>()
    if (duplicate) return finish(env, row.id, "skipped", `Version ${row.version} is already published (${duplicate.name}). Withdraw or delete it, then retry, to publish this tag instead.`)

    const provider = PROVIDER_IMPLEMENTATIONS[source.provider]
    let commit = row.commit_sha
    if (!commit) {
      const resolved = await provider.resolveCommit(source, row.ref)
      if ("error" in resolved) return finish(env, row.id, "failed", resolved.error)
      commit = resolved.commit
      await env.DB.prepare("UPDATE source_imports SET commit_sha = ? WHERE id = ?").bind(commit, row.id).run()
    }
    const archive = await provider.downloadArchive(source, commit, MAX_FILE_BYTES)
    if ("error" in archive) return finish(env, row.id, "failed", archive.error)

    const zip = repackZip(archive.bytes, source.package_folder)
    if (zip.size > MAX_FILE_BYTES) return finish(env, row.id, "failed", `The package exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB file limit.`)
    const name = packageFileName(source.package_folder, row.version)
    const stored = await storeFile(env, owner, {
      name,
      version: row.version,
      channel: channelForVersion(row.version),
      statuses: source.statuses,
      checkDomain: source.check_domain === 1,
      notes: `Published from ${PROVIDER_INFO[source.provider].host}/${source.repository}, tag ${row.ref}, commit ${commit.slice(0, 7)}.`,
      contentType: "application/zip",
      size: zip.size,
      body: partsStream(zip.parts),
    })
    if ("error" in stored) return finish(env, row.id, "failed", stored.error)
    await finish(env, row.id, "imported", `Published ${name}.`, stored.file.id)
  } catch (error) {
    await finish(env, row.id, "failed", error instanceof ZipError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Webhook deliveries are small; a tag push carries no file contents. */
const MAX_WEBHOOK_BYTES = 1024 * 1024

/**
 * Receives a provider's webhook: POST /hooks/<provider>/<source id>. Authenticated by the delivery's signature, made
 * with the source's webhook secret. Answers quickly and publishes in the background.
 */
export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext, providerKey: string, sourceId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, { status: 405, headers: { allow: "POST" } })
  const source = await getSourceById(env, sourceId)
  if (!source || source.provider !== providerKey) return json({ error: "No release source matches this address." }, { status: 404 })
  const body = await readTextUpTo(request, MAX_WEBHOOK_BYTES)
  if (body === null) return json({ error: "The delivery exceeds 1 MB." }, { status: 413 })

  const event = await PROVIDER_IMPLEMENTATIONS[source.provider].readWebhook(request, body, source)
  if ("error" in event) return json({ error: (event as ProviderFailure).error }, { status: event.status })
  await env.DB.prepare("UPDATE release_sources SET last_delivery_at = ? WHERE id = ?").bind(Date.now(), source.id).run()

  if (event.kind === "ping")
    return json({
      ok: true,
      message: "Webhook received. Push a tag to publish a release.",
    })
  if (event.kind === "ignored") return json({ ok: true, ignored: event.reason })
  if (source.enabled !== 1) return json({ ok: true, ignored: "The source is paused in Warden." })
  const row = await startImport(env, ctx, source, event.tag, event.commit)
  return json(
    {
      ok: true,
      import: {
        id: row.id,
        tag: row.ref,
        version: row.version,
        state: row.state,
        detail: row.detail,
      },
    },
    { status: 202 },
  )
}

/**
 * Handles the source intents of an app or licence page. Returns `{ ok: true }` or `{ error }` for the page's
 * fetcher, or null when the intent is not a source intent.
 */
export async function applySourceForm(env: Env, ctx: ExecutionContext, owner: FileOwner, form: FormData): Promise<{ ok: true } | { error: string } | null> {
  const intent = String(form.get("intent"))
  if (!["save-source", "delete-source", "regenerate-source-secret", "import-tag", "retry-import"].includes(intent)) return null
  if (intent === "save-source") {
    const text = (name: string) => (form.has(name) ? String(form.get(name)) : undefined)
    const flag = (name: string) => (form.has(name) ? form.get(name) === "true" : undefined)
    const saved = await saveSource(env, owner, {
      provider: text("provider"),
      repository: text("repository"),
      trigger: text("trigger"),
      package_folder: text("package_folder"),
      statuses: text("statuses"),
      check_domain: flag("check_domain"),
      // An empty token field keeps the current token; removing it is a separate checkbox.
      token: form.get("remove_token") === "true" ? "" : text("token") || undefined,
      enabled: flag("enabled"),
    })
    return "error" in saved ? { error: saved.error } : { ok: true }
  }
  const source = await getSource(env, owner)
  if (!source) return { error: "No repository is connected. Reload the page." }
  if (intent === "delete-source") await deleteSource(env, source)
  else if (intent === "regenerate-source-secret") await regenerateWebhookSecret(env, source)
  else if (intent === "import-tag") {
    const tag = String(form.get("tag") ?? "").trim()
    if (!tag) return { error: "Enter the tag to publish, for example v1.4.0." }
    const row = await startImport(env, ctx, source, tag)
    if (row.state === "imported") return { error: `${row.ref} is already published.` }
  } else {
    const row = await getImport(env, source.id, String(form.get("importId")))
    if (!row) return { error: "That import no longer exists. Reload the page." }
    const retried = await retryImport(env, ctx, source, row)
    if ("error" in retried) return { error: retried.error }
  }
  return { ok: true }
}
