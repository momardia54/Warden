import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { DEFAULT_STATUSES } from "../app/lib/statuses.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { handleCheck, MAX_CHECK_BODY_BYTES } from "../app/server/check.server.ts"
import { contentDisposition, handleDownload } from "../app/server/download.server.ts"
import { getFile, storeFile } from "../app/server/files.server.ts"
import { createLicense, getLicense, queryLicenses, type LicenseInput } from "../app/server/licenses.server.ts"
import { createApp } from "../app/server/apps.server.ts"
import { customizeStatuses, deleteStatus, saveStatusSet, statusUsage } from "../app/server/statuses.server.ts"

const license: LicenseInput = { name: "L", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }

function setup() {
  const { bucket } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  return { env, ctx, settle }
}
const body = (text: string) => new Response(text).body

test("download names that are not plain ASCII are sent safely", () => {
  assert.equal(contentDisposition("theme.zip"), `attachment; filename="theme.zip"; filename*=UTF-8''theme.zip`)
  assert.equal(contentDisposition("主题 1.0.zip"), `attachment; filename="__ 1.0.zip"; filename*=UTF-8''%E4%B8%BB%E9%A2%98%201.0.zip`)
  assert.equal(contentDisposition("it's (final).zip"), `attachment; filename="it's (final).zip"; filename*=UTF-8''it%27s%20%28final%29.zip`)
  // every header value must be Latin-1, or the runtime refuses the response
  for (const name of ["主题.zip", "émoji 🎉.zip", "a\\\\b.zip"]) assert.ok([...contentDisposition(name)].every((c) => c.charCodeAt(0) <= 0xff), name)
  assert.doesNotThrow(() => new Headers({ "content-disposition": contentDisposition("主题.zip") }))
})

test("downloads: unicode names, sandboxing, and HEAD is not counted", async () => {
  const { env, ctx, settle } = setup()
  const lic = await createLicense(env, license)
  const file = (await storeFile(env, { license: lic }, { name: "主题.zip", size: 5, body: body("hello"), checkDomain: false })) as { file: { id: string } }
  const request = (method: string) => handleDownload(new Request(`https://w.dev/download/${lic.license_key}/${file.file.id}`, { method }), env, ctx, lic.license_key, file.file.id)

  const head = await request("HEAD")
  await settle()
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
  assert.equal((await getFile(env, { license: lic }, file.file.id))!.download_count, 0)

  const res = await request("GET")
  await settle()
  assert.equal(res.status, 200)
  assert.equal(await res.text(), "hello")
  assert.match(res.headers.get("content-disposition")!, /filename\*=UTF-8''%E4%B8%BB%E9%A2%98\.zip/)
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; sandbox")
  assert.equal(res.headers.get("x-content-type-options"), "nosniff")
  assert.equal((await getFile(env, { license: lic }, file.file.id))!.download_count, 1)
})

test("the check endpoint reads only small POST bodies", async () => {
  const { env, ctx, settle } = setup()
  const lic = await createLicense(env, license)
  const post = async (payload: string, length?: number) => {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (length !== undefined) headers["content-length"] = String(length)
    await handleCheck(new Request(`https://w.dev/check/${lic.license_key}`, { method: "POST", headers, body: payload }), env, ctx, lic.license_key)
    await settle()
    return (await getLicense(env, lic.id))!.last_check_domain
  }
  const small = JSON.stringify({ domain: "a.com" })
  assert.equal(await post(small, small.length), "a.com")
  const large = JSON.stringify({ domain: "b.com", padding: "x".repeat(MAX_CHECK_BODY_BYTES) })
  assert.equal(await post(large, large.length), null) // ignored, the check still answers
  assert.equal(await post("not json", 8), null)
})

test("status keys are matched exactly in file rules (an underscore is not a wildcard)", async () => {
  const { env } = setup()
  const created = (await createApp(env, { name: "A", slug: "a", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })) as { app: { id: string } }
  const app = created.app
  const extra = (key: string) => ({ ...DEFAULT_STATUSES[1], key, label: key, is_default: false, on_expiry: null })
  assert.deepEqual(await saveStatusSet(env, { app: app.id }, [...DEFAULT_STATUSES, extra("a_b"), extra("axb")].map((s, i) => ({ ...s, position: i + 1 }))), { ok: true })
  const file = (await storeFile(env, { app: app as never }, { name: "f.zip", statuses: "axb", size: 1, body: body("x") })) as { file: { id: string } }

  assert.deepEqual(await statusUsage(env, { app: app.id }, "a_b"), { licenses: 0, files: 0 })
  assert.deepEqual(await statusUsage(env, { app: app.id }, "axb"), { licenses: 0, files: 1 })
  assert.ok("set" in (await deleteStatus(env, { app: app.id }, "a_b", "completed")))
  assert.equal((await getFile(env, { app: app as never }, file.file.id))!.statuses, "axb") // untouched
})

test("API: a malformed path is a client error, not a crash", async () => {
  const { env, ctx } = setup()
  const key = (await createApiKey(env, "m", "manage")).secret
  const lic = await createLicense(env, license)
  const res = await handleApi(new Request(`https://w.dev/api/v1/licenses/${lic.id}/activations/%E0%A4%A`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }), env, ctx)
  assert.equal(res.status, 400)
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "invalid_domain")
})

test("API keys are 40 random letters and digits", async () => {
  const { env } = setup()
  const keys = await Promise.all(Array.from({ length: 50 }, (_, i) => createApiKey(env, `k${i}`, "read")))
  const all = keys.map((k) => k.secret)
  for (const secret of all) assert.match(secret, /^wk_[A-Za-z0-9]{40}$/)
  assert.equal(new Set(all).size, 50)
  const chars = all.map((s) => s.slice(3)).join("")
  assert.ok(/[A-Z]/.test(chars) && /[a-z]/.test(chars) && /[0-9]/.test(chars)) // the whole alphabet is used
})

test("filtering by status works with many customised licences, across pages and batches", async () => {
  const { env } = setup()
  const gold = { ...DEFAULT_STATUSES[1], key: "gold", label: "Gold", is_default: false, on_expiry: null }
  const goldIds = new Set<string>()
  // 260 licences cross the 200-licence batch; 70 of them have their own statuses (more than D1's 100-parameter limit would allow in one SQL condition).
  for (let i = 0; i < 260; i++) {
    const lic = await createLicense(env, { ...license, name: `L${i}` })
    if (i % 3 === 0 && goldIds.size < 70) {
      await customizeStatuses(env, { license: lic.id })
      await saveStatusSet(env, { license: lic.id }, [...DEFAULT_STATUSES, { ...gold, position: 7 }])
      await env.DB.prepare("UPDATE licenses SET status = 'gold' WHERE id = ?").bind(lic.id).run()
      goldIds.add(lic.id)
    }
  }
  await env.DB.prepare("UPDATE licenses SET expires_at = ? WHERE name IN ('L1', 'L2')").bind(Date.now() - 1000).run()

  const seen: string[] = []
  let before: string | undefined
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const page = await queryLicenses(env, { status: "gold", before, limit: 8 })
    seen.push(...page.map((l) => l.id))
    if (page.length < 8) break
    before = page[page.length - 1].id
  }
  assert.equal(seen.length, 70)
  assert.deepEqual(new Set(seen), goldIds)
  assert.deepEqual((await queryLicenses(env, { status: "expired", limit: 50 })).map((l) => l.name).sort(), ["L1", "L2"])
  assert.equal((await queryLicenses(env, { status: "active", limit: 500 })).length, 260 - 70 - 2)
})

test("request bodies are not read beyond their limit, even without a Content-Length", async () => {
  const { readTextUpTo } = await import("../app/server/api-http.server.ts")
  const streamed = (size: number) =>
    new Request("https://w.dev/x", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          for (let sent = 0; sent < size; sent += 1000) controller.enqueue(new TextEncoder().encode("x".repeat(Math.min(1000, size - sent))))
          controller.close()
        },
      }),
      duplex: "half",
    } as RequestInit)
  assert.equal(await readTextUpTo(streamed(5000), 4096), null)
  assert.equal((await readTextUpTo(streamed(3000), 4096))?.length, 3000)
  assert.equal(await readTextUpTo(new Request("https://w.dev/x", { method: "POST", body: "abc", headers: { "content-length": "99999" } }), 4096), null)

  const { env, ctx } = setup()
  const key = (await createApiKey(env, "m", "manage")).secret
  const big = streamed(70 * 1024)
  big.headers.set("authorization", `Bearer ${key}`)
  const res = await handleApi(new Request("https://w.dev/api/v1/licenses", { method: "POST", headers: big.headers, body: big.body, duplex: "half" } as RequestInit), env, ctx)
  assert.equal(res.status, 413)
  assert.equal(res.headers.get("x-content-type-options"), "nosniff")
})

test("creating two apps with the same identifier at once gives a clear error", async () => {
  const { env } = setup()
  const input = { name: "Same", slug: "same", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" }
  const results = await Promise.all([createApp(env, input), createApp(env, input)])
  assert.equal(results.filter((r) => "app" in r).length, 1)
  assert.deepEqual(results.find((r) => "error" in r), { error: "Another app already uses this identifier." })
})
