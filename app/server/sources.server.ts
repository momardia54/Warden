import { MAX_FILE_BYTES } from "../lib/files"
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
import { splitStatusKeys } from "../lib/statuses"
import { partsStream, repackZip, ZipError } from "../lib/zip"
import { readTextUpTo } from "./api-http.server"
import { getApp } from "./apps.server"
import { findAppRepository, getGitHubApp, installationToken } from "./github-app.server"
import { statusSetForOwner, storeFile, type FileOwner } from "./files.server"
import { getLicense } from "./licenses.server"
import { github } from "./source-providers/github.server"
import type { ProviderFailure, ProviderSource, SourceProvider } from "./source-providers/types"
import { getTrack, listTracks, type ReleaseTrack } from "./tracks.server"
import { json, newId } from "./util.server"
import { prefixForTag, TAG_PREFIX_PATTERN, trackView } from "../lib/tracks"

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
  /** Set when the repository is reached through the install's GitHub App; null when it uses `token`. */
  installation_id: number | null
  /** The provider's numeric id of the repository, which survives renames. */
  repository_id: number | null
  /** The track this repository publishes into. */
  track_id: string | null
  /** Tags this source publishes start with this ("" for v1.4.0, "final-" for final-v1.4.0). */
  tag_prefix: string
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
  /** app: through the install's GitHub App; token: an access token (optional) and a webhook of its own. */
  connection: "app" | "token"
  has_token: boolean
  enabled: boolean
  check_domain: boolean
  status_keys: string[]
  webhook_url: string
}

type Failure = { error: string; status: number }

const ownerColumn = (owner: FileOwner) => ("license" in owner ? "license_id" : "app_id")
const ownerId = (owner: FileOwner) => ("license" in owner ? owner.license.id : owner.app.id)

/** The repositories connected to an app or licence, one per track. */
export async function listSources(env: Env, owner: FileOwner): Promise<ReleaseSource[]> {
  return (await env.DB.prepare(`SELECT * FROM release_sources WHERE ${ownerColumn(owner)} = ? ORDER BY created_at`).bind(ownerId(owner)).all<ReleaseSource>()).results
}

/** The repository connected to a track, if any. */
export function getSourceForTrack(env: Env, owner: FileOwner, trackId: string): Promise<ReleaseSource | null> {
  return env.DB.prepare(`SELECT * FROM release_sources WHERE track_id = ? AND ${ownerColumn(owner)} = ?`).bind(trackId, ownerId(owner)).first<ReleaseSource>()
}

export function getSourceById(env: Env, id: string): Promise<ReleaseSource | null> {
  return env.DB.prepare("SELECT * FROM release_sources WHERE id = ?").bind(id).first<ReleaseSource>()
}

export async function publicSource(env: Env, source: ReleaseSource, origin: string): Promise<PublicSource> {
  const { token, options: _options, ...rest } = source
  const owner = await ownerOf(env, source)
  const track = owner && source.track_id ? await getTrack(env, owner, source.track_id) : null
  const statuses = track?.statuses ?? source.statuses
  return {
    ...rest,
    connection: source.installation_id ? "app" : "token",
    has_token: token !== "",
    enabled: source.enabled === 1,
    check_domain: (track?.check_domain ?? source.check_domain) === 1,
    status_keys: owner ? splitStatusKeys(statuses, await statusSetForOwner(env, owner)) : statuses.split(",").filter(Boolean),
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
  /** Tags this source publishes start with this prefix ("" by default). */
  tag_prefix?: unknown
  /** Not accepted: a repository publishes into its track, which decides availability. */
  statuses?: unknown
  check_domain?: unknown
  /** app (through the GitHub App) or token. Default for a new source: app when a GitHub App is connected and no token is sent. */
  connection?: unknown
  /** A new token; "" removes it; absent keeps the current one. Ignored with connection app. */
  token?: unknown
  enabled?: unknown
}

/**
 * Connects a repository to a track, or changes the connected one. The repository is checked with the provider first,
 * so a typo or a token without access is reported now rather than on the first tag.
 */
export async function saveSource(env: Env, owner: FileOwner, track: ReleaseTrack, input: SourceInput, now = Date.now()): Promise<{ source: ReleaseSource; created: boolean } | Failure> {
  if (input.statuses !== undefined || input.check_domain !== undefined) {
    return { error: `A repository publishes into its track ("${track.name}"), which decides which statuses receive its releases. Change the track instead.`, status: 422 }
  }
  const current = await getSourceForTrack(env, owner, track.id)
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

  const rawPrefix = input.tag_prefix === undefined ? (current?.tag_prefix ?? "") : input.tag_prefix
  if (typeof rawPrefix !== "string" || !TAG_PREFIX_PATTERN.test(rawPrefix.trim())) return { error: "The tag prefix may contain only letters, digits, dots, dashes, underscores and slashes, up to 40 characters.", status: 422 }
  const tagPrefix = rawPrefix.trim()
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") return { error: "enabled must be true or false.", status: 422 }
  if (input.token !== undefined && typeof input.token !== "string") return { error: "token must be a string.", status: 422 }
  let token = input.token === undefined ? (current?.token ?? "") : (input.token as string).trim()
  if (token.length > 500 || /\s/.test(token)) return { error: "The access token is not valid.", status: 422 }
  const enabled = input.enabled === undefined ? (current?.enabled ?? 1) : input.enabled ? 1 : 0

  // Two tracks fed by the same repository need different tag prefixes, or every tag would publish twice.
  const others = (await listSources(env, owner)).filter((o) => o.id !== current?.id)
  const clash = others.find((o) => o.provider === provider && o.repository.toLowerCase() === repository.toLowerCase() && o.tag_prefix === tagPrefix)
  if (clash) {
    const tracks = await listTracks(env, owner)
    const name = tracks.find((t) => t.id === clash.track_id)?.name ?? "another track"
    return { error: `${repository} already publishes into "${name}" with ${tagPrefix ? `the tag prefix "${tagPrefix}"` : "no tag prefix"}. Use a different tag prefix for this track, for example "final-".`, status: 409 }
  }

  const githubApp = provider === "github" ? await getGitHubApp(env) : null
  const connection =
    input.connection !== undefined
      ? input.connection
      : current
        ? current.installation_id
          ? "app"
          : "token"
        : githubApp && !(typeof input.token === "string" && input.token.trim())
          ? "app"
          : "token"
  if (connection !== "app" && connection !== "token") return { error: "connection must be app or token.", status: 422 }

  // Check access only when what is checked changed: the repository, the provider, the connection or the token.
  let name = repository
  let installationId = current?.installation_id ?? null
  let repositoryId = current?.repository_id ?? null
  const unchanged = current && current.repository === repository && current.provider === provider
  if (connection === "app") {
    if (!githubApp) return { error: "No GitHub App is connected. Connect GitHub under Integrations, or connect this repository with an access token.", status: 422 }
    token = ""
    if (!unchanged || !current.installation_id) {
      const found = await findAppRepository(githubApp, repository)
      if ("error" in found) return { error: found.error, status: 422 }
      name = found.full_name
      installationId = found.installation_id
      repositoryId = found.repository_id
    }
  } else {
    installationId = null
    if (!unchanged || current.installation_id || current.token !== token) {
      const access = await PROVIDER_IMPLEMENTATIONS[provider].checkAccess({ repository, token, webhook_secret: "" })
      if ("error" in access) return { error: access.error, status: 422 }
      repositoryId = access.id
    }
  }

  if (current) {
    await env.DB.prepare(
      "UPDATE release_sources SET provider = ?, repository = ?, trigger = ?, package_folder = ?, tag_prefix = ?, statuses = ?, check_domain = ?, token = ?, enabled = ?, installation_id = ?, repository_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(provider, name, trigger, folder, tagPrefix, track.statuses, track.check_domain, token, enabled, installationId, repositoryId, now, current.id)
      .run()
    return { source: (await getSourceById(env, current.id))!, created: false }
  }
  const id = newId("src")
  await env.DB.prepare(
    `INSERT INTO release_sources (id, app_id, license_id, track_id, tag_prefix, provider, repository, trigger, package_folder, statuses, check_domain, token, webhook_secret, enabled, installation_id, repository_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      "app" in owner ? owner.app.id : null,
      "license" in owner ? owner.license.id : null,
      track.id,
      tagPrefix,
      provider,
      name,
      trigger,
      folder,
      track.statuses,
      track.check_domain,
      token,
      generateSecret(40),
      enabled,
      installationId,
      repositoryId,
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
  const version = ref.startsWith(source.tag_prefix) ? (versionFromTag(ref.slice(source.tag_prefix.length)) ?? "") : ""
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
    const example = `${source.tag_prefix}v1.4.0`
    await finish(env, id, "skipped", `"${ref}" is not a version tag of this track, so nothing was published. Name its release tags like ${example}.`)
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
    const track = source.track_id ? await getTrack(env, owner, source.track_id) : null
    if (!track) return finish(env, row.id, "failed", "This repository is not connected to a track. Connect it to a track again.")
    // Versions are unique within a track: another track (a final build, say) may publish the same number.
    const duplicate = await env.DB.prepare("SELECT name FROM files WHERE track_id = ? AND version = ? AND withdrawn_at IS NULL LIMIT 1")
      .bind(track.id, row.version)
      .first<{ name: string }>()
    if (duplicate) return finish(env, row.id, "skipped", `Version ${row.version} is already published in "${track.name}" (${duplicate.name}). Withdraw or delete it, then retry, to publish this tag instead.`)

    const provider = PROVIDER_IMPLEMENTATIONS[source.provider]
    const access = await credentials(env, source)
    if ("error" in access) return finish(env, row.id, "failed", access.error)
    let commit = row.commit_sha
    if (!commit) {
      const resolved = await provider.resolveCommit(access, row.ref)
      if ("error" in resolved) return finish(env, row.id, "failed", resolved.error)
      commit = resolved.commit
      await env.DB.prepare("UPDATE source_imports SET commit_sha = ? WHERE id = ?").bind(commit, row.id).run()
    }
    const archive = await provider.downloadArchive(access, commit, MAX_FILE_BYTES)
    if ("error" in archive) return finish(env, row.id, "failed", archive.error)

    const zip = repackZip(archive.bytes, source.package_folder)
    if (zip.size > MAX_FILE_BYTES) return finish(env, row.id, "failed", `The package exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB file limit.`)
    const name = packageFileName(source.package_folder, row.version)
    const stored = await storeFile(env, owner, {
      name,
      version: row.version,
      channel: channelForVersion(row.version),
      track: track.id,
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

/** What the provider is called with: the source's own token, or a short-lived token of the GitHub App. */
async function credentials(env: Env, source: ReleaseSource): Promise<ProviderSource | Failure> {
  if (!source.installation_id) return source
  const app = await getGitHubApp(env)
  if (!app) return { error: "The GitHub App is no longer connected. Connect GitHub again under Integrations, or switch this repository to an access token.", status: 502 }
  const token = await installationToken(app, source.installation_id)
  return "error" in token ? token : { ...source, token: token.token }
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
  // The tag belongs to the track of this repository whose prefix it matches most specifically (as for the GitHub App).
  const siblings = (await env.DB.prepare("SELECT tag_prefix FROM release_sources WHERE repository = ? AND provider = ? AND app_id IS ? AND license_id IS ?")
    .bind(source.repository, source.provider, source.app_id, source.license_id)
    .all<{ tag_prefix: string }>()).results.map((r) => r.tag_prefix)
  if (prefixForTag(event.tag, siblings) !== source.tag_prefix) return json({ ok: true, ignored: `This tag belongs to another track. Tags of this track start with "${source.tag_prefix}".` })
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
  const track = await getTrack(env, owner, String(form.get("trackId") ?? ""))
  if (!track) return { error: "That track no longer exists. Reload the page." }
  if (intent === "save-source") {
    const text = (name: string) => (form.has(name) ? String(form.get(name)) : undefined)
    const flag = (name: string) => (form.has(name) ? form.get(name) === "true" : undefined)
    const saved = await saveSource(env, owner, track, {
      connection: text("connection"),
      provider: text("provider"),
      repository: text("repository"),
      trigger: text("trigger"),
      package_folder: text("package_folder"),
      tag_prefix: text("tag_prefix"),
      // An empty token field keeps the current token; removing it is a separate checkbox.
      token: form.get("remove_token") === "true" ? "" : text("token") || undefined,
      enabled: flag("enabled"),
    })
    return "error" in saved ? { error: saved.error } : { ok: true }
  }
  const source = await getSourceForTrack(env, owner, track.id)
  if (!source) return { error: "No repository is connected to this track. Reload the page." }
  if (intent === "delete-source") await deleteSource(env, source)
  else if (intent === "regenerate-source-secret") await regenerateWebhookSecret(env, source)
  else if (intent === "import-tag") {
    const tag = String(form.get("tag") ?? "").trim()
    if (!tag) return { error: `Enter the tag to publish, for example ${source.tag_prefix}v1.4.0.` }
    if (!tag.startsWith(source.tag_prefix)) return { error: `Tags of this track start with "${source.tag_prefix}", for example ${source.tag_prefix}v1.4.0.` }
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

/**
 * Receives the GitHub App's webhook: POST /hooks/github-app, one address for every repository the app can access.
 * Signed with the app's webhook secret. A tag push publishes a release for every enabled source connected to that
 * repository through the app.
 */
export async function handleAppWebhook(request: Request, env: Env, ctx: ExecutionContext, now = Date.now()): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, { status: 405, headers: { allow: "POST" } })
  const app = await getGitHubApp(env)
  if (!app) return json({ error: "No GitHub App is connected to this Warden." }, { status: 404 })
  const body = await readTextUpTo(request, MAX_WEBHOOK_BYTES)
  if (body === null) return json({ error: "The delivery exceeds 1 MB." }, { status: 413 })

  const event = await PROVIDER_IMPLEMENTATIONS.github.readWebhook(request, body, { repository: "", token: "", webhook_secret: app.webhook_secret })
  if ("error" in event) return json({ error: event.error }, { status: event.status })
  await env.DB.prepare("UPDATE settings SET value = json_set(value, '$.last_delivery_at', ?) WHERE key = 'github_app'").bind(now).run()
  if (event.kind === "ping") return json({ ok: true, message: "Webhook received." })
  if (event.kind === "ignored") return json({ ok: true, ignored: event.reason })
  if (event.repository_id === null) return json({ ok: true, ignored: "The delivery names no repository." })

  const sources = (
    await env.DB.prepare("SELECT * FROM release_sources WHERE provider = 'github' AND installation_id IS NOT NULL AND repository_id = ?").bind(event.repository_id).all<ReleaseSource>()
  ).results
  if (sources.length === 0) return json({ ok: true, ignored: "No app or licence in Warden is connected to this repository." })
  // Within one app or licence, a tag goes to the track whose tag prefix it matches most specifically.
  const ownerKey = (s: ReleaseSource) => s.app_id ?? `l:${s.license_id}`
  const chosen = new Set<string>()
  for (const key of new Set(sources.map(ownerKey))) {
    const mine = sources.filter((s) => ownerKey(s) === key)
    const prefix = prefixForTag(event.tag, mine.map((s) => s.tag_prefix))
    for (const s of mine) if (prefix !== null && s.tag_prefix === prefix) chosen.add(s.id)
  }
  const imports = []
  for (const source of sources) {
    if (!chosen.has(source.id)) continue
    // Follow a renamed repository, so the dashboard shows its current name.
    await env.DB.prepare("UPDATE release_sources SET last_delivery_at = ?, repository = CASE WHEN ? = '' THEN repository ELSE ? END WHERE id = ?")
      .bind(now, event.repository, event.repository, source.id)
      .run()
    if (source.enabled !== 1) continue
    const row = await startImport(env, ctx, { ...source, repository: event.repository || source.repository }, event.tag, event.commit, now)
    imports.push({ source: source.id, id: row.id, tag: row.ref, version: row.version, state: row.state })
  }
  return json({ ok: true, imports }, { status: imports.length > 0 ? 202 : 200 })
}

/** The tracks of an app or licence for its page: each with its repository (without secrets) and its latest imports. */
export async function trackPanels(env: Env, owner: FileOwner, origin: string, importsPerSource = 5) {
  const [tracks, sources] = await Promise.all([listTracks(env, owner), listSources(env, owner)])
  return Promise.all(
    tracks.map(async (track) => {
      const source = sources.find((s) => s.track_id === track.id) ?? null
      const [view, imports] = source ? await Promise.all([publicSource(env, source, origin), listImports(env, source.id, importsPerSource)]) : [null, []]
      return { track: trackView(track), source: view, imports }
    })
  )
}
