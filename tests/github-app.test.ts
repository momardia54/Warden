import { test } from "node:test"
import assert from "node:assert/strict"
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto"
import { makeBucket, makeCtx, makeDb, mockFetch, type Sent } from "./helpers/d1.ts"
import { buildZip, readZip } from "./helpers/zip.ts"
import { appManifest, defaultAppName, manifestTarget } from "../app/lib/github-app.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { listFiles } from "../app/server/files.server.ts"
import { appJwt, completeManifest, getGitHubApp, listAppRepositories, removeGitHubApp, resetGitHubAppCache, type GitHubApp } from "../app/server/github-app.server.ts"
import { createLicense, type LicenseInput } from "../app/server/licenses.server.ts"
import { deleteSource, getSource, handleAppWebhook, listImports, saveSource } from "../app/server/sources.server.ts"
import { hmacHex } from "../app/server/util.server.ts"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } })
const SHA = "68e8cc77bb1bbd0bf7d629d3574b6ca70289b2cc"
const base: LicenseInput = { name: "Harbor", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }

const conversion = { id: 4242, slug: "warden-harbor", name: "Warden harbor", client_id: "Iv1.abc", client_secret: "cs", webhook_secret: "hook-secret", pem: privateKey, html_url: "https://github.com/apps/warden-harbor", owner: { login: "harbor-studio" } }

/** GitHub, as far as the app flow needs it. `renamed` makes the repository report a new name. */
function github(state: { installed?: boolean } = {}) {
  return mockFetch((s: Sent) => {
    const url = s.url
    if (url === "https://api.github.com/app-manifests/good-code/conversions") return Response.json(conversion, { status: 201 })
    if (url.startsWith("https://api.github.com/app-manifests/")) return new Response("", { status: 404 })
    if (url === "https://api.github.com/repos/harbor-studio/harbor-theme/installation") return state.installed === false ? new Response("", { status: 404 }) : Response.json({ id: 77 })
    if (url === "https://api.github.com/app/installations/77/access_tokens") return Response.json({ token: "ghs_installation", expires_at: new Date(Date.now() + 3600_000).toISOString() }, { status: 201 })
    if (url.startsWith("https://api.github.com/app/installations")) return Response.json([{ id: 77, account: { login: "harbor-studio", type: "Organization" }, repository_selection: "selected", html_url: "https://github.com/organizations/harbor-studio/settings/installations/77" }])
    if (url.startsWith("https://api.github.com/installation/repositories")) {
      return Response.json({ repositories: [{ id: 556, full_name: "harbor-studio/maple-plugin", private: false }, { id: 555, full_name: "harbor-studio/harbor-theme", private: true }] })
    }
    if (url === "https://api.github.com/repos/harbor-studio/harbor-theme") return Response.json({ id: 555, full_name: "harbor-studio/harbor-theme", private: true })
    if (url.includes("/zipball/")) return new Response(buildZip([["harbor-studio-harbor-theme-68e8cc7/style.css", "/* Harbor */"]], { comment: SHA }))
    return new Response("not found", { status: 404 })
  })
}

async function setup() {
  resetGitHubAppCache()
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  const license = await createLicense(env, base)
  return { env, objects, ctx, settle, owner: { license } }
}

async function deliver(env: Env, ctx: ExecutionContext, event: string, payload: unknown, secret = "hook-secret") {
  const body = JSON.stringify(payload)
  const request = new Request("https://w.dev/hooks/github-app", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": `sha256=${await hmacHex(secret, body)}` },
    body,
  })
  return handleAppWebhook(request, env, ctx)
}

test("the manifest asks for read access to contents and push events only", () => {
  const manifest = appManifest("https://warden.harbor.dev", "")
  assert.equal(manifest.name, "Warden warden")
  assert.deepEqual(manifest.default_permissions, { contents: "read", metadata: "read" })
  assert.deepEqual(manifest.default_events, ["push"])
  assert.equal(manifest.hook_attributes.url, "https://warden.harbor.dev/hooks/github-app")
  assert.equal(manifest.redirect_url, "https://warden.harbor.dev/integrations/github/callback")
  assert.equal(manifest.public, false)
  assert.equal(defaultAppName("https://a-very-long-subdomain-name-for-a-warden.example.com").length <= 34, true)
  assert.equal(manifestTarget("", "s1"), "https://github.com/settings/apps/new?state=s1")
  assert.equal(manifestTarget("harbor-studio", "s1"), "https://github.com/organizations/harbor-studio/settings/apps/new?state=s1")
})

test("the app token is an RS256 JWT signed with the app's PKCS#1 key", async () => {
  const app = { ...conversion, app_id: 4242, owner: "harbor-studio", created_at: 0 } as unknown as GitHubApp
  const now = Date.UTC(2026, 9, 10, 12)
  const jwt = await appJwt(app, now)
  const [header, payload, signature] = jwt.split(".")
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" })
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString())
  assert.equal(claims.iss, "4242")
  assert.equal(claims.iat, now / 1000 - 60)
  assert.equal(claims.exp, now / 1000 + 540)
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey(publicKey), Buffer.from(signature, "base64url")), true)
})

test("the manifest code is exchanged for the app's credentials", async () => {
  const { env } = await setup()
  const gh = github()
  assert.ok("error" in (await completeManifest(env, "expired-code")))
  assert.ok("error" in (await completeManifest(env, "../../bad")))
  assert.equal(await getGitHubApp(env), null)
  const created = await completeManifest(env, "good-code")
  assert.ok("app" in created)
  const stored = await getGitHubApp(env)
  assert.deepEqual([stored?.app_id, stored?.slug, stored?.owner, stored?.webhook_secret], [4242, "warden-harbor", "harbor-studio", "hook-secret"])
  const repositories = await listAppRepositories(stored!)
  assert.ok(Array.isArray(repositories))
  assert.deepEqual(repositories.map((r) => [r.full_name, r.private, r.account]), [["harbor-studio/harbor-theme", true, "harbor-studio"], ["harbor-studio/maple-plugin", false, "harbor-studio"]])
  // Installation tokens are requested with the app's JWT, and only for contents and metadata.
  const tokenRequest = gh.sent.find((s) => s.url.endsWith("/access_tokens"))!
  assert.match(tokenRequest.headers.get("authorization") ?? "", /^Bearer ey/)
  assert.deepEqual(JSON.parse(tokenRequest.body), { permissions: { contents: "read", metadata: "read" } })
  gh.restore()
})

test("a repository connected through the app publishes tags pushed to the app's webhook", async () => {
  const { env, ctx, settle, objects, owner } = await setup()
  const gh = github()
  await completeManifest(env, "good-code")

  // With the app connected, a new source uses it by default; no token is stored.
  const saved = await saveSource(env, owner, { repository: "harbor-studio/harbor-theme" })
  assert.ok("source" in saved)
  assert.deepEqual([saved.source.installation_id, saved.source.repository_id, saved.source.token], [77, 555, ""])

  assert.equal((await deliver(env, ctx, "push", { ref: "refs/tags/v1.0.0" }, "wrong")).status, 401)
  assert.equal((await deliver(env, ctx, "ping", { zen: "Speak like a human." })).status, 200)
  const other = await deliver(env, ctx, "push", { ref: "refs/tags/v1.0.0", after: SHA, repository: { id: 999, full_name: "harbor-studio/other" } })
  assert.match(((await other.json()) as { ignored: string }).ignored, /No app or licence/)

  // The repository was renamed on GitHub: it is matched by id and the new name is kept.
  const pushed = await deliver(env, ctx, "push", { ref: "refs/tags/v1.4.0", after: SHA, repository: { id: 555, full_name: "harbor-studio/harbor-wp-theme" } })
  assert.equal(pushed.status, 202)
  await settle()
  const [file] = await listFiles(env, owner)
  assert.deepEqual([file.name, file.version], ["harbor-theme-1.4.0.zip", "1.4.0"])
  assert.deepEqual(readZip(objects.get(file.r2_key)!.bytes).files, { "harbor-theme/style.css": "/* Harbor */" })
  const archive = gh.sent.find((s) => s.url.includes("/zipball/"))!
  assert.equal(archive.url, `https://api.github.com/repos/harbor-studio/harbor-wp-theme/zipball/${SHA}`)
  assert.equal(archive.headers.get("authorization"), "Bearer ghs_installation")
  const source = (await getSource(env, owner))!
  assert.equal(source.repository, "harbor-studio/harbor-wp-theme")
  assert.equal((await listImports(env, source.id))[0].state, "imported")
  assert.ok((await getGitHubApp(env))?.last_delivery_at)

  // The app cannot be removed while a repository uses it.
  assert.ok("error" in (await removeGitHubApp(env)))
  await deleteSource(env, source)
  assert.deepEqual(await removeGitHubApp(env), { ok: true })
  assert.equal(await getGitHubApp(env), null)
  gh.restore()
})

test("a repository the app cannot access is reported, and a token connection stays available", async () => {
  const { env, owner } = await setup()
  const gh = github({ installed: false })
  await completeManifest(env, "good-code")
  const refused = await saveSource(env, owner, { repository: "harbor-studio/harbor-theme" })
  assert.ok("error" in refused && /cannot access harbor-studio\/harbor-theme/.test(refused.error))
  const withToken = await saveSource(env, owner, { repository: "harbor-studio/harbor-theme", connection: "token" })
  assert.ok("source" in withToken)
  assert.deepEqual([withToken.source.installation_id, withToken.source.repository_id], [null, 555])
  gh.restore()
})

test("API: the GitHub integration is readable without its secrets", async () => {
  const { env, ctx } = await setup()
  const read = (await createApiKey(env, "r", "read")).secret
  const call = (path: string) => handleApi(new Request(`https://w.dev/api/v1${path}`, { headers: { authorization: `Bearer ${read}` } }), env, ctx)
  const gh = github()
  assert.deepEqual(await (await call("/integrations/github")).json(), { connected: false, app: null, installations: [] })
  assert.equal((await call("/integrations/github/repositories")).status, 404)
  await completeManifest(env, "good-code")
  const text = await (await call("/integrations/github")).text()
  assert.match(text, /"connected":true/)
  assert.match(text, /"account":"harbor-studio"/)
  for (const secret of ["hook-secret", "RSA PRIVATE KEY", "client_secret"]) assert.equal(text.includes(secret), false, secret)
  const repos = (await (await call("/integrations/github/repositories")).json()) as { data: { full_name: string }[] }
  assert.equal(repos.data.length, 2)
  gh.restore()
})
