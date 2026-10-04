import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { cleanFileName, evaluateFileAccess, MAX_FILE_BYTES } from "../app/lib/files.ts"
import { buildCheckResponse } from "../app/lib/license.ts"
import { DEFAULT_STATUSES, effectiveStatusKey, parseStatusKeys } from "../app/lib/statuses.ts"
import { createLicense, deleteLicense, getLicense, overviewStats, setStatus, extendLicense, recentActivity } from "../app/server/licenses.server.ts"
import { deleteFile, getFile, listFiles, storeFile, updateFile } from "../app/server/files.server.ts"
import { handleDownload } from "../app/server/download.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"

const DAY = 86_400_000
const input = { name: "Harbor", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active" as const, expires_at: null, domains: "", message: "", notes: "" }

function setup() {
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  return { env, objects, ctx, settle }
}
const body = (text: string) => new Response(text).body
async function upload(env: Env, license: Awaited<ReturnType<typeof createLicense>>, statuses: string, name = "theme.zip", text = "PK-zip-bytes", checkDomain = true) {
  const res = await storeFile(env, { license }, { name, statuses, checkDomain, version: "1.0.0", size: new TextEncoder().encode(text).length, body: body(text), contentType: "application/zip" })
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

test("statuses are parsed in canonical order and validated", () => {
  assert.deepEqual(parseStatusKeys("completed, active", DEFAULT_STATUSES), ["active", "completed"])
  assert.deepEqual(parseStatusKeys(["Suspended", "suspended"], DEFAULT_STATUSES), ["suspended"])
  assert.equal(parseStatusKeys("", DEFAULT_STATUSES), null)
  assert.equal(parseStatusKeys("active,bogus", DEFAULT_STATUSES), null)
  assert.equal(parseStatusKeys(5, DEFAULT_STATUSES), null)
})

test("completed is valid and permanent", () => {
  const now = Date.now()
  const done = { name: "x", status: "completed", expires_at: now - DAY, domains: "", message: "" }
  assert.equal(effectiveStatusKey(done, DEFAULT_STATUSES, now), "completed") // the expiry date does not apply once completed
  assert.equal(buildCheckResponse(done, null, now, [], DEFAULT_STATUSES).valid, true)
})

test("a file is released only in the statuses it lists", () => {
  const now = Date.now()
  const lic = { status: "active", expires_at: null as number | null, domains: "" }
  const rule = (statuses: string, check_domain = true) => ({ statuses: parseStatusKeys(statuses, DEFAULT_STATUSES)!, check_domain })

  assert.equal(evaluateFileAccess(lic, rule("active,completed"), null, now, false, DEFAULT_STATUSES).allowed, true)
  assert.equal(evaluateFileAccess(lic, rule("completed"), null, now, false, DEFAULT_STATUSES).allowed, false)
  assert.match(evaluateFileAccess(lic, rule("completed"), null, now, false, DEFAULT_STATUSES).message, /Completed/)
  assert.equal(evaluateFileAccess({ ...lic, status: "completed" }, rule("completed"), null, now, false, DEFAULT_STATUSES).allowed, true)
  assert.equal(evaluateFileAccess({ ...lic, status: "suspended" }, rule("suspended"), null, now, false, DEFAULT_STATUSES).allowed, true) // e.g. a maintenance notice
  for (const status of ["pending", "suspended", "disabled"]) assert.equal(evaluateFileAccess({ ...lic, status }, rule("active,completed"), null, now, false, DEFAULT_STATUSES).allowed, false)

  // expiry is part of the effective status
  assert.equal(evaluateFileAccess({ ...lic, expires_at: now - 1 }, rule("active"), null, now, false, DEFAULT_STATUSES).allowed, false)
  assert.equal(evaluateFileAccess({ ...lic, expires_at: now - 1 }, rule("expired"), null, now, false, DEFAULT_STATUSES).allowed, true)

  // domain check is per file
  const locked = { ...lic, domains: "harborstudio.com" }
  assert.equal(evaluateFileAccess(locked, rule("active"), "other.com", now, false, DEFAULT_STATUSES).allowed, false)
  assert.equal(evaluateFileAccess(locked, rule("active"), "shop.harborstudio.com", now, false, DEFAULT_STATUSES).allowed, true)
  assert.equal(evaluateFileAccess(locked, rule("active", false), null, now, false, DEFAULT_STATUSES).allowed, true)
  assert.equal(evaluateFileAccess(locked, rule("active"), null, now, true, DEFAULT_STATUSES).allowed, true) // dashboard preview
})

test("upload validation", async () => {
  const { env } = setup()
  const lic = await createLicense(env, input)
  const bad = (r: unknown) => assert.ok(r && typeof r === "object" && "error" in r, "expected an error")
  bad(await storeFile(env, { license: lic }, { name: "", size: 5, body: body("hello") }))
  bad(await storeFile(env, { license: lic }, { name: "a.zip", statuses: "bogus", size: 5, body: body("hello") }))
  bad(await storeFile(env, { license: lic }, { name: "a.zip", size: 0, body: body("") }))
  bad(await storeFile(env, { license: lic }, { name: "a.zip", size: MAX_FILE_BYTES + 1, body: body("x") }))
  const noStorage = await storeFile({ DB: env.DB } as Env, { license: lic }, { name: "a.zip", size: 5, body: body("hello") })
  assert.equal("error" in noStorage && noStorage.status, 501)
  assert.equal((await listFiles(env, { license: lic })).length, 0)
})

test("download rules, logging and counters", async () => {
  const { env, ctx, settle } = setup()
  const lic = await createLicense(env, { ...input, domains: "harborstudio.com" })
  const upd = await upload(env, lic, "active,completed", "theme-update.zip", "update-bytes")
  const fin = await upload(env, lic, "completed", "theme-final.zip", "final-bytes", false)
  const maint = await upload(env, lic, "suspended", "maintenance.html", "<h1>Back soon</h1>", false)
  const get = async (path: string) => {
    const res = await handleDownload(new Request(`https://w.dev/download/${path}`), env, ctx, lic.license_key, path.split("/")[1]?.split("?")[0] ?? null)
    await settle()
    return res
  }

  // active licence: the update downloads, the completed-only file is refused
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
  assert.match((await lockedFinal.json() as any).message, /status is: Completed/)

  // listing shows what is available
  const list = await (await get(`${lic.license_key}?domain=harborstudio.com`)).json() as any
  assert.deepEqual(list.files.map((f: any) => [f.name, f.available]).sort(), [["maintenance.html", false], ["theme-final.zip", false], ["theme-update.zip", true]])
  assert.deepEqual(list.files.find((f: any) => f.name === "theme-final.zip").statuses, ["completed"])

  // suspended: nothing downloads
  await setStatus(env, (await getLicense(env, lic.id))!, "suspended")
  assert.equal((await get(`${lic.license_key}/${upd.id}?domain=harborstudio.com`)).status, 403)
  assert.equal(await (await get(`${lic.license_key}/${maint.id}`)).text(), "<h1>Back soon</h1>") // released only while suspended

  // completed (paid in full): both download, no domain needed for the final file
  await setStatus(env, (await getLicense(env, lic.id))!, "completed")
  const final = await get(`${lic.license_key}/${fin.id}`)
  assert.equal(final.status, 200)
  assert.equal(await final.text(), "final-bytes")

  assert.equal((await getFile(env, { license: lic }, upd.id))!.download_count, 1)
  assert.equal((await getFile(env, { license: lic }, fin.id))!.download_count, 1)
  const log = (await recentActivity(env, lic.id)).filter((a) => a.event === "download").map((a) => a.detail).join("|")
  assert.match(log, /Downloaded: theme-update.zip/)
  assert.match(log, /Download refused: theme-final.zip \(available when Completed\)/)

  // unknown key and unknown file
  const unknown = await handleDownload(new Request("https://w.dev/download/WRD-AAAAA-AAAAA-AAAAA-AAAAA"), env, ctx, "WRD-AAAAA-AAAAA-AAAAA-AAAAA", null)
  assert.equal(unknown.status, 404)
  assert.equal((await get(`${lic.license_key}/fil_nothere`)).status, 404)
  // a file id from another licence is not reachable through this key
  const other = await createLicense(env, input)
  const foreign = await upload(env, other, "active", "x.zip")
  assert.equal((await get(`${lic.license_key}/${foreign.id}`)).status, 404)
})

test("deleting a file or a licence removes the stored objects", async () => {
  const { env, objects } = setup()
  const lic = await createLicense(env, input)
  const a = await upload(env, lic, "active", "a.zip")
  await upload(env, lic, "completed", "b.zip")
  assert.equal(objects.size, 2)
  await deleteFile(env, { license: lic }, a)
  assert.equal(objects.size, 1)
  await deleteLicense(env, lic.id)
  assert.equal(objects.size, 0)
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS c FROM files").first<{ c: number }>())!.c, 0)
})

test("a file's release rule can be changed afterwards", async () => {
  const { env } = setup()
  const lic = await createLicense(env, input)
  const file = await upload(env, lic, "completed", "final.zip")
  assert.equal((await updateFile(env, { license: lic }, file, { statuses: "bogus" }) as any).status, 422)
  const changed = await updateFile(env, { license: lic }, file, { statuses: ["active", "completed"], checkDomain: false, version: "2.0.0" })
  assert.ok("file" in changed)
  if ("file" in changed) {
    assert.equal(changed.file.statuses, "active,completed")
    assert.equal(changed.file.check_domain, 0)
    assert.equal(changed.file.version, "2.0.0")
  }
  assert.match((await recentActivity(env, lic.id)).map((a) => a.detail).join("|"), /File updated: final.zip \(available when Active, Completed\)/)
})

test("renewing a completed licence keeps it completed; stats count it", async () => {
  const { env } = setup()
  const lic = await createLicense(env, { ...input, status: "completed" as never })
  await extendLicense(env, lic, 30)
  assert.equal((await getLicense(env, lic.id))!.status, "completed")
  assert.equal((await overviewStats(env)).byStatus.completed, 1)
})

test("API: upload, list, update, delete, permissions", async () => {
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

  const put = await call("PUT", `/licenses/${lic.id}/files?name=theme.zip&statuses=completed&version=2.0&check_domain=false`, manage, "zip-bytes")
  assert.equal(put.status, 201)
  assert.deepEqual([put.json.statuses, put.json.check_domain, put.json.available], [["completed"], false, false])
  assert.equal(put.json.download_url, `https://w.dev/download/${lic.key}/${put.json.id}`)
  assert.equal((await call("PUT", `/licenses/${lic.id}/files?name=x.zip`, read, "zz")).status, 403)
  assert.equal((await call("PUT", `/licenses/${lic.id}/files?statuses=completed`, manage, "zz")).status, 422)
  assert.equal((await call("PUT", `/licenses/${lic.id}/files?name=x.zip&statuses=nope`, manage, "zz")).status, 422)
  assert.deepEqual((await call("PUT", `/licenses/${lic.id}/files?name=default.zip`, manage, "zz")).json.statuses, ["active", "completed"])

  assert.equal((await call("GET", `/licenses/${lic.id}/files`, read)).json.data.length, 2)
  assert.equal((await call("POST", `/licenses/${lic.id}/status`, manage, JSON.stringify({ status: "completed" }))).json.valid, true)
  assert.equal((await call("GET", `/licenses/${lic.id}/files`, read)).json.data.find((f: any) => f.name === "theme.zip").available, true)

  const patched = await call("PATCH", `/licenses/${lic.id}/files/${put.json.id}`, manage, JSON.stringify({ statuses: ["suspended"], check_domain: true }))
  assert.deepEqual([patched.json.statuses, patched.json.check_domain], [["suspended"], true])
  assert.equal((await call("PATCH", `/licenses/${lic.id}/files/${put.json.id}`, read, "{}")).status, 403)
  assert.equal((await call("PATCH", `/licenses/${lic.id}/files/${put.json.id}`, manage, JSON.stringify({ statuses: [] }))).status, 422)

  assert.equal((await call("DELETE", `/licenses/${lic.id}/files/${put.json.id}`, read)).status, 403)
  assert.equal((await call("DELETE", `/licenses/${lic.id}/files/${put.json.id}`, manage)).json.deleted, true)
  assert.equal((await call("GET", `/licenses/${lic.id}/files`, read)).json.data.length, 1)
})
