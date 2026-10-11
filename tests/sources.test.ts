import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb, mockFetch, type Sent } from "./helpers/d1.ts"
import { channelForVersion, parseRepository, versionFromTag } from "../app/lib/sources.ts"
import { repackZip, ZipError } from "../app/lib/zip.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApp, deleteApp } from "../app/server/apps.server.ts"
import { listFiles } from "../app/server/files.server.ts"
import { createLicense, deleteLicense, type LicenseInput } from "../app/server/licenses.server.ts"
import { getSourceForTrack, handleWebhook, listImports, pruneImports, retryImport, saveSource, startImport } from "../app/server/sources.server.ts"
import { hmacHex } from "../app/server/util.server.ts"
import { createTrack, type ReleaseTrack } from "../app/server/tracks.server.ts"
import { buildZip, readZip } from "./helpers/zip.ts"

const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts))

test("repacking renames the top-level folder and keeps every entry intact", () => {
  for (const descriptor of [false, true]) {
    const zip = buildZip(
      [
        ["harbor-studio-harbor-theme-3f2a9c1/", ""],
        ["harbor-studio-harbor-theme-3f2a9c1/style.css", "/* Theme Name: Harbor */"],
        ["harbor-studio-harbor-theme-3f2a9c1/inc/setup.php", "<?php // setup"],
      ],
      { comment: "3f2a9c1", descriptor }
    )
    const out = repackZip(zip, "harbor-theme")
    assert.equal(out.previousFolder, "harbor-studio-harbor-theme-3f2a9c1")
    const read = readZip(join(out.parts))
    assert.deepEqual(read.files, { "harbor-theme/": "", "harbor-theme/style.css": "/* Theme Name: Harbor */", "harbor-theme/inc/setup.php": "<?php // setup" })
    assert.equal(read.comment, "3f2a9c1")
    assert.equal(out.size, join(out.parts).length)
  }
  // Entries not inside one folder are moved into the new one.
  const flat = repackZip(buildZip([["a.txt", "a"], ["sub/b.txt", "b"]]), "harbor-plugin")
  assert.equal(flat.previousFolder, null)
  assert.deepEqual(readZip(join(flat.parts)).files, { "harbor-plugin/a.txt": "a", "harbor-plugin/sub/b.txt": "b" })

  assert.throws(() => repackZip(new TextEncoder().encode("not a zip at all, just text"), "x"), ZipError)
  assert.throws(() => repackZip(buildZip([["a", "a"]]), "../escape"), ZipError)
})

test("repositories, tags and channels are read", () => {
  assert.equal(parseRepository("github", "harbor-studio/harbor-theme"), "harbor-studio/harbor-theme")
  assert.equal(parseRepository("github", "https://github.com/harbor-studio/harbor-theme.git"), "harbor-studio/harbor-theme")
  assert.equal(parseRepository("github", "git@github.com:harbor-studio/harbor-theme.git"), "harbor-studio/harbor-theme")
  for (const bad of ["harbor-theme", "a/b/c", "https://gitlab.com/a/b", "a/..", ""]) assert.equal(parseRepository("github", bad), null, bad)
  assert.equal(versionFromTag("v1.4.0"), "1.4.0")
  assert.equal(versionFromTag("2.0.0-beta.1"), "2.0.0-beta.1")
  assert.equal(versionFromTag("nightly"), null)
  assert.equal(channelForVersion("2.0.0-beta.1"), "beta")
  assert.equal(channelForVersion("2.0.0"), "stable")
})

// ---- the GitHub flow, with GitHub replaced by a stub --------------------------------------------------

const SHA = "3f2a9c1e5b7d4a6c8e0f1a2b3c4d5e6f7a8b9c0d"
const base: LicenseInput = { name: "Harbor", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }

function github(options: { archive?: () => Response; repo?: () => Response } = {}) {
  return mockFetch((s: Sent) => {
    if (s.url === "https://api.github.com/repos/harbor-studio/harbor-theme") return options.repo?.() ?? Response.json({ private: false })
    if (s.url.startsWith("https://api.github.com/repos/harbor-studio/harbor-theme/commits/")) return new Response(SHA)
    if (s.url.startsWith("https://api.github.com/repos/harbor-studio/harbor-theme/zipball/")) {
      return options.archive?.() ?? new Response(buildZip([["harbor-studio-harbor-theme-3f2a9c1/style.css", "/* Harbor */"]], { comment: SHA }))
    }
    return new Response("not found", { status: 404 })
  })
}

async function setup() {
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  const license = await createLicense(env, base)
  // Repositories publish into a track: one serving the valid statuses, as before tracks existed.
  const made = await createTrack(env, { license }, { name: "Updates", statuses: "active,completed" })
  const track = (made as { track: ReleaseTrack }).track
  return { env, objects, ctx, settle, track, license, owner: { license } }
}

async function deliver(env: Env, ctx: ExecutionContext, sourceId: string, secret: string, event: string, payload: unknown, signWith = secret) {
  const body = JSON.stringify(payload)
  const request = new Request(`https://w.dev/hooks/github/${sourceId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": `sha256=${await hmacHex(signWith, body)}` },
    body,
  })
  return handleWebhook(request, env, ctx, "github", sourceId)
}

test("connecting a repository checks access, keeps the token private and defaults the package folder", async () => {
  const { env, owner, track } = await setup()
  const denied = github({ repo: () => new Response("", { status: 404 }) })
  const missing = await saveSource(env, owner, track, { repository: "harbor-studio/harbor-theme", token: "github_pat_x" })
  denied.restore()
  assert.ok("error" in missing && /private and the access token cannot read it/.test(missing.error))

  const gh = github()
  const saved = await saveSource(env, owner, track, { repository: "https://github.com/harbor-studio/harbor-theme", token: "github_pat_x" })
  assert.ok("source" in saved && saved.created)
  assert.equal(saved.source.package_folder, "harbor-theme")
  assert.equal(saved.source.statuses, "active,completed")
  assert.equal(gh.sent[0].headers.get("authorization"), "Bearer github_pat_x")

  // Editing without a new token keeps the token and does not check access again.
  const calls = gh.sent.length
  const edited = await saveSource(env, owner, track, { package_folder: "harbor" })
  assert.ok("source" in edited && !edited.created)
  assert.equal(edited.source.token, "github_pat_x")
  assert.equal(gh.sent.length, calls)
  assert.ok("error" in (await saveSource(env, owner, track, { package_folder: ".hidden" })))
  gh.restore()
})

test("a pushed tag is published as a release, once, with a fixed folder", async () => {
  const { env, objects, ctx, settle, owner, track } = await setup()
  const gh = github()
  const saved = await saveSource(env, owner, track, { repository: "harbor-studio/harbor-theme" })
  assert.ok("source" in saved)
  const { id, webhook_secret: secret } = saved.source

  assert.equal((await deliver(env, ctx, id, secret, "push", { ref: "refs/tags/v1.4.0", after: SHA }, "wrong-secret")).status, 401)
  assert.equal((await deliver(env, ctx, id, secret, "ping", { zen: "Keep it simple." })).status, 200)
  const branch = await deliver(env, ctx, id, secret, "push", { ref: "refs/heads/main", after: SHA })
  assert.match(((await branch.json()) as { ignored: string }).ignored, /Branch pushes publish nothing/)

  const pushed = await deliver(env, ctx, id, secret, "push", { ref: "refs/tags/v1.4.0", after: SHA, created: true })
  assert.equal(pushed.status, 202)
  await settle()
  const [file] = await listFiles(env, owner)
  assert.deepEqual([file.name, file.version, file.channel, file.content_type], ["harbor-theme-1.4.0.zip", "1.4.0", "stable", "application/zip"])
  assert.match(file.notes, /github\.com\/harbor-studio\/harbor-theme, tag v1\.4\.0, commit 3f2a9c1/)
  assert.deepEqual(readZip(objects.get(file.r2_key)!.bytes).files, { "harbor-theme/style.css": "/* Harbor */" })
  assert.ok(file.sha256.length === 64)
  // The commit came with the delivery, so only the archive was requested.
  assert.deepEqual(gh.sent.filter((s) => s.url.includes("/zipball/")).length, 1)

  // GitHub redelivers: nothing new is published.
  assert.equal((await deliver(env, ctx, id, secret, "push", { ref: "refs/tags/v1.4.0", after: SHA })).status, 202)
  await settle()
  assert.equal((await listFiles(env, owner)).length, 1)

  // A pre-release tag goes to the beta channel; a tag that is not a version is skipped.
  await deliver(env, ctx, id, secret, "push", { ref: "refs/tags/v2.0.0-beta.1", after: SHA })
  await deliver(env, ctx, id, secret, "push", { ref: "refs/tags/nightly", after: SHA })
  await settle()
  assert.equal((await listFiles(env, owner)).find((f) => f.version === "2.0.0-beta.1")?.channel, "beta")
  const imports = await listImports(env, id)
  assert.deepEqual(
    imports.map((i) => [i.ref, i.state]),
    [["nightly", "skipped"], ["v2.0.0-beta.1", "imported"], ["v1.4.0", "imported"]]
  )
  assert.ok((await getSourceForTrack(env, owner, track.id))!.last_delivery_at)
  gh.restore()
})

test("failures are recorded and can be retried; existing versions are not published twice", async () => {
  const { env, ctx, settle, owner, track } = await setup()
  let broken = true
  const gh = github({ archive: () => (broken ? new Response("", { status: 404 }) : new Response(buildZip([["r-abc/readme.txt", "hi"]]))) })
  const saved = await saveSource(env, owner, track, { repository: "harbor-studio/harbor-theme" })
  assert.ok("source" in saved)
  const source = saved.source

  // A manual import resolves the tag to its commit first.
  const started = await startImport(env, ctx, source, "v1.0.0")
  await settle()
  assert.ok(gh.sent.some((s) => s.url.endsWith("/commits/v1.0.0")))
  let [row] = await listImports(env, source.id)
  assert.equal(row.state, "failed")
  assert.match(row.detail, /GitHub returned 404/)
  assert.equal(row.commit_sha, SHA)

  // GitHub answers 422 for a tag that does not exist.
  const unknown = mockFetch((sent) => (sent.url.includes("/commits/") ? new Response("", { status: 422 }) : Response.json({})))
  const missing = await startImport(env, ctx, source, "v7.7.7")
  await settle()
  unknown.restore()
  assert.match((await listImports(env, source.id)).find((i) => i.id === missing.id)!.detail, /^The tag or reference "v7\.7\.7" does not exist/)

  broken = false
  const retried = await retryImport(env, ctx, source, row)
  assert.ok(!("error" in retried) && retried.id === started.id)
  await settle()
  row = (await listImports(env, source.id)).find((i) => i.id === started.id)!
  assert.equal(row.state, "imported")
  assert.ok("error" in (await retryImport(env, ctx, source, row)))

  // Version 1.0.0 is published; a second tag with the same version is skipped.
  await startImport(env, ctx, source, "1.0.0")
  await settle()
  const skipped = (await listImports(env, source.id)).find((i) => i.ref === "1.0.0")!
  assert.equal(skipped.state, "skipped")
  assert.match(skipped.detail, /already published/)
  assert.equal((await listFiles(env, owner)).length, 1)

  // An import whose Worker stopped is reported as failed, and marked so by the cron.
  const stale = { id: "imp_stale" }
  await env.DB.prepare("INSERT INTO source_imports (id, source_id, ref, version, state, started_at) VALUES (?, ?, 'v9.9.9', '9.9.9', 'pending', ?)").bind(stale.id, source.id, Date.now() - 60 * 60_000).run()
  assert.equal((await listImports(env, source.id)).find((i) => i.id === stale.id)?.state, "failed")
  await pruneImports(env)
  assert.equal((await env.DB.prepare("SELECT state FROM source_imports WHERE id = ?").bind(stale.id).first<{ state: string }>())?.state, "failed")
  await settle()
  gh.restore()
})

test("deleting the owner removes its source", async () => {
  const { env, license, owner, track } = await setup()
  const gh = github()
  await saveSource(env, owner, track, { repository: "harbor-studio/harbor-theme" })
  await deleteLicense(env, license.id)
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM release_sources").first<{ n: number }>())?.n, 0)

  const created = await createApp(env, { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })
  assert.ok("app" in created)
  const appTrack = (await createTrack(env, { app: created.app }, { name: "Updates", statuses: "active" }) as { track: ReleaseTrack }).track
  await saveSource(env, { app: created.app }, appTrack, { repository: "harbor-studio/harbor-theme" })
  assert.deepEqual(await deleteApp(env, created.app), { ok: true })
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM release_sources").first<{ n: number }>())?.n, 0)
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM release_tracks").first<{ n: number }>())?.n, 0)
  gh.restore()
})

test("API: connect, read without the token, import a tag and list imports", async () => {
  const { env, ctx, settle } = await setup()
  const full = (await createApiKey(env, "f", "full")).secret
  const read = (await createApiKey(env, "r", "read")).secret
  const created = await createApp(env, { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })
  assert.ok("app" in created)
  const gh = github()
  const call = (key: string, method: string, path: string, body?: unknown) =>
    handleApi(new Request(`https://w.dev/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx)

  const made = await call(full, "POST", "/apps/harbor-theme/tracks", { name: "Updates", statuses: ["active", "completed"] })
  assert.equal(made.status, 201)
  const trackId = ((await made.json()) as { id: string }).id
  // A track can be addressed by id or by name.
  assert.equal((await call(full, "GET", "/apps/harbor-theme/tracks/Updates/source")).status, 404)
  const put = await call(full, "PUT", `/apps/harbor-theme/tracks/${trackId}/source`, { repository: "harbor-studio/harbor-theme", token: "github_pat_secret", package_folder: "harbor" })
  assert.equal(put.status, 201)
  const source = (await put.json()) as Record<string, unknown>
  assert.equal(source.token, undefined)
  assert.equal(source.has_token, true)
  assert.equal(source.package_folder, "harbor")
  assert.equal(source.track_id, trackId)
  assert.equal(source.tag_prefix, "")
  assert.match(String(source.webhook_url), /^https:\/\/w\.dev\/hooks\/github\/src_/)
  assert.equal(typeof source.webhook_secret, "string")
  const asReader = (await (await call(read, "GET", "/apps/harbor-theme/tracks/Updates/source")).json()) as Record<string, unknown>
  assert.equal(asReader.webhook_secret, undefined)
  assert.equal((await call(read, "PUT", "/apps/harbor-theme/tracks/Updates/source", { package_folder: "x" })).status, 403)

  const started = await call(full, "POST", "/apps/harbor-theme/tracks/Updates/source/imports", { tag: "v1.2.0" })
  assert.equal(started.status, 202)
  await settle()
  const list = (await (await call(read, "GET", "/apps/harbor-theme/tracks/Updates/source/imports")).json()) as { data: { tag: string; state: string; version: string }[] }
  assert.deepEqual(list.data.map((i) => [i.tag, i.version, i.state]), [["v1.2.0", "1.2.0", "imported"]])
  const files = (await (await call(read, "GET", "/apps/harbor-theme/files")).json()) as { data: { name: string }[] }
  assert.deepEqual(files.data.map((f) => f.name), ["harbor-1.2.0.zip"])

  assert.equal((await call(full, "DELETE", "/apps/harbor-theme/tracks/Updates/source")).status, 200)
  assert.equal((await call(full, "GET", "/apps/harbor-theme/tracks/Updates/source")).status, 404)
  gh.restore()
})
