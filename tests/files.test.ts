import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { cleanFileName, fileAccess, MAX_FILE_BYTES } from "../app/lib/files.ts"
import { buildAnswer, effectiveStatus } from "../app/lib/license.ts"
import { createLicense, deleteLicense, getLicense, overviewStats, setStatus, extendLicense, recentActivity } from "../app/server/licenses.server.ts"
import { deleteFile, getFile, listFiles, storeFile } from "../app/server/files.server.ts"
import { handleDownload } from "../app/server/download.server.ts"
import { createApiKey, handleApi } from "../app/server/api.server.ts"

const DAY = 86_400_000
const input = { name: "Harbor", client: "", status: "active" as const, expires_at: null, domains: "", message: "", notes: "" }

function setup() {
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  return { env, objects, ctx, settle }
}
const body = (text: string) => new Response(text).body
async function upload(env: Env, license: Awaited<ReturnType<typeof createLicense>>, kind: string, name = "theme.zip", text = "PK-zip-bytes") {
  const res = await storeFile(env, license, { name, kind, version: "1.0.0", size: new TextEncoder().encode(text).length, body: body(text), contentType: "application/zip" })
  assert.ok("file" in res, JSON.stringify(res))
  return res.file
}

test("file names are cleaned", () => {
  assert.equal(cleanFileName("../../etc/passwd"), "passwd")
  assert.equal(cleanFileName('C:\\temp\\my "theme".zip'), "my theme.zip")
  assert.equal(cleanFileName("..."), null)
  assert.equal(cleanFileName("   "), null)
  assert.equal(cleanFileName(".htaccess"), "htaccess")
})

test("completed is valid, permanent, and unlocks final files only", () => {
  const now = Date.now()
  const done = { name: "x", status: "completed", expires_at: now - DAY, domains: "", message: "" }
  assert.equal(effectiveStatus(done, now), "completed") // an end date does not expire a completed licence
  assert.equal(buildAnswer(done, null, now).valid, true)
  assert.equal(fileAccess(done, "final", null, now).allowed, true)
  assert.equal(fileAccess(done, "update", null, now).allowed, true)

  const active = { ...done, status: "active", expires_at: null }
  assert.equal(fileAccess(active, "update", null, now).allowed, true)
  assert.equal(fileAccess(active, "final", null, now).allowed, false)
  for (const status of ["pending", "suspended", "disabled"]) assert.equal(fileAccess({ ...active, status }, "update", null, now).allowed, false)
  assert.equal(fileAccess({ ...active, expires_at: now - 1 }, "update", null, now).allowed, false)

  const locked = { ...active, domains: "harborstudio.com" }
  assert.equal(fileAccess(locked, "update", "other.com", now).allowed, false)
  assert.equal(fileAccess(locked, "update", "shop.harborstudio.com", now).allowed, true)
  assert.equal(fileAccess({ ...locked, status: "completed" }, "final", null, now).allowed, true) // domains do not apply to final files
})

test("upload validation", async () => {
  const { env } = setup()
  const lic = await createLicense(env, input)
  const bad = (r: unknown) => assert.ok(r && typeof r === "object" && "error" in r, "expected an error")
  bad(await storeFile(env, lic, { name: "", kind: "update", size: 5, body: body("hello") }))
  bad(await storeFile(env, lic, { name: "a.zip", kind: "bogus", size: 5, body: body("hello") }))
  bad(await storeFile(env, lic, { name: "a.zip", kind: "update", size: 0, body: body("") }))
  bad(await storeFile(env, lic, { name: "a.zip", kind: "update", size: MAX_FILE_BYTES + 1, body: body("x") }))
  const noStorage = await storeFile({ DB: env.DB } as Env, lic, { name: "a.zip", kind: "update", size: 5, body: body("hello") })
  assert.equal("error" in noStorage && noStorage.status, 501)
  assert.equal((await listFiles(env, lic.id)).length, 0)
})

test("download rules, logging and counters", async () => {
  const { env, ctx, settle } = setup()
  const lic = await createLicense(env, { ...input, domains: "harborstudio.com" })
  const upd = await upload(env, lic, "update", "theme-update.zip", "update-bytes")
  const fin = await upload(env, lic, "final", "theme-final.zip", "final-bytes")
  const get = async (path: string) => {
    const res = await handleDownload(new Request(`https://w.dev/download/${path}`), env, ctx, lic.license_key, path.split("/")[1]?.split("?")[0] ?? null)
    await settle()
    return res
  }

  // active licence: the update downloads, the final file stays locked
  const ok = await get(`${lic.license_key}/${upd.id}?domain=harborstudio.com`)
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), "update-bytes")
  assert.match(ok.headers.get("content-disposition")!, /attachment; filename="theme-update.zip"/)
  assert.equal(ok.headers.get("content-type"), "application/zip")

  const wrongDomain = await get(`${lic.license_key}/${upd.id}?domain=evil.com`)
  assert.equal(wrongDomain.status, 403)
  assert.equal((await wrongDomain.json() as any).status, "domain_mismatch")

  const lockedFinal = await get(`${lic.license_key}/${fin.id}?domain=harborstudio.com`)
  assert.equal(lockedFinal.status, 403)
  assert.match((await lockedFinal.json() as any).message, /paid in full/)

  // listing shows what is available
  const list = await (await get(`${lic.license_key}?domain=harborstudio.com`)).json() as any
  assert.deepEqual(list.files.map((f: any) => [f.kind, f.available]).sort(), [["final", false], ["update", true]])

  // suspended: nothing downloads
  await setStatus(env, (await getLicense(env, lic.id))!, "suspended")
  assert.equal((await get(`${lic.license_key}/${upd.id}?domain=harborstudio.com`)).status, 403)

  // completed (paid in full): both download, no domain needed for the final file
  await setStatus(env, (await getLicense(env, lic.id))!, "completed")
  const final = await get(`${lic.license_key}/${fin.id}`)
  assert.equal(final.status, 200)
  assert.equal(await final.text(), "final-bytes")

  assert.equal((await getFile(env, lic.id, upd.id))!.download_count, 1)
  assert.equal((await getFile(env, lic.id, fin.id))!.download_count, 1)
  const log = (await recentActivity(env, lic.id)).filter((a) => a.kind === "download").map((a) => a.detail).join("|")
  assert.match(log, /Downloaded: theme-update.zip \(update\)/)
  assert.match(log, /Download refused: theme-final.zip \(final\)/)

  // unknown key and unknown file
  const unknown = await handleDownload(new Request("https://w.dev/download/WRD-AAAAA-AAAAA-AAAAA-AAAAA"), env, ctx, "WRD-AAAAA-AAAAA-AAAAA-AAAAA", null)
  assert.equal(unknown.status, 404)
  assert.equal((await get(`${lic.license_key}/fil_nothere`)).status, 404)
  // a file id from another licence is not reachable through this key
  const other = await createLicense(env, input)
  const foreign = await upload(env, other, "update", "x.zip")
  assert.equal((await get(`${lic.license_key}/${foreign.id}`)).status, 404)
})

test("deleting a file or a licence removes the stored objects", async () => {
  const { env, objects } = setup()
  const lic = await createLicense(env, input)
  const a = await upload(env, lic, "update", "a.zip")
  await upload(env, lic, "final", "b.zip")
  assert.equal(objects.size, 2)
  await deleteFile(env, lic, a)
  assert.equal(objects.size, 1)
  await deleteLicense(env, lic.id)
  assert.equal(objects.size, 0)
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS c FROM files").first<{ c: number }>())!.c, 0)
})

test("renewing a completed licence keeps it completed; stats count it", async () => {
  const { env } = setup()
  const lic = await createLicense(env, { ...input, status: "completed" as never })
  await extendLicense(env, lic, 30)
  assert.equal((await getLicense(env, lic.id))!.status, "completed")
  assert.equal((await overviewStats(env)).counts.completed, 1)
})

test("API: upload, list, download link, delete, scopes, completed", async () => {
  const { env, ctx, settle } = setup()
  const read = (await createApiKey(env, "r", "read")).secret
  const manage = (await createApiKey(env, "m", "manage")).secret
  const call = async (method: string, path: string, key: string, payload?: BodyInit) => {
    const headers: Record<string, string> = { authorization: `Bearer ${key}` }
    if (payload !== undefined) headers["content-length"] = String(typeof payload === "string" ? new TextEncoder().encode(payload).length : 0)
    const res = await handleApi(new Request(`https://w.dev/api/v1${path}`, { method, headers, body: payload }), env, ctx)
    await settle()
    return { status: res.status, json: (await res.json()) as any }
  }
  const lic = (await call("POST", "/licenses", manage, JSON.stringify({ name: "A" }))).json

  const put = await call("PUT", `/licenses/${lic.id}/files?name=theme.zip&kind=final&version=2.0`, manage, "zip-bytes")
  assert.equal(put.status, 201)
  assert.equal(put.json.kind, "final")
  assert.equal(put.json.download_url, `https://w.dev/download/${lic.key}/${put.json.id}`)
  assert.equal((await call("PUT", `/licenses/${lic.id}/files?name=x.zip`, read, "zz")).status, 403)
  assert.equal((await call("PUT", `/licenses/${lic.id}/files?kind=final`, manage, "zz")).status, 422)

  assert.equal((await call("GET", `/licenses/${lic.id}/files`, read)).json.data.length, 1)
  assert.equal((await call("POST", `/licenses/${lic.id}/status`, manage, JSON.stringify({ status: "completed" }))).json.valid, true)
  assert.equal((await call("DELETE", `/licenses/${lic.id}/files/${put.json.id}`, read)).status, 403)
  assert.equal((await call("DELETE", `/licenses/${lic.id}/files/${put.json.id}`, manage)).json.deleted, true)
  assert.equal((await call("GET", `/licenses/${lic.id}/files`, read)).json.data.length, 0)
})
