import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { compareVersions, isValidSlug, latestVersioned, slugify } from "../app/lib/apps.ts"
import { buildCheckResponse } from "../app/lib/license.ts"
import { appDefaults, createApp, deleteApp, findApp, getAppSummary, listApps, readAppForm, updateApp } from "../app/server/apps.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { handleDownload } from "../app/server/download.server.ts"
import { deleteFile, getFile, listFiles, storeFile } from "../app/server/files.server.ts"
import { createLicense, deleteLicense, getLicense, listActivations, queryLicenses, recordActivation, releaseActivation, type LicenseInput } from "../app/server/licenses.server.ts"

const baseLicense: LicenseInput = { name: "Licence", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }
const appInput = { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: 365, default_status: "active" as const, default_max_sites: 1, default_message: "", notes: "" }

function setup() {
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  return { env, objects, ctx, settle }
}
const body = (text: string) => new Response(text).body
async function newApp(env: Env, overrides: Partial<typeof appInput> = {}) {
  const res = await createApp(env, { ...appInput, ...overrides })
  assert.ok("app" in res, JSON.stringify(res))
  return (res as { app: Awaited<ReturnType<typeof findApp>> & object }).app
}

test("slugs and versions", () => {
  assert.equal(slugify("Harbor Theme Pro!"), "harbor-theme-pro")
  assert.equal(slugify("  Café  Menü "), "cafe-menu")
  assert.equal(isValidSlug("harbor-theme"), true)
  for (const bad of ["a", "Harbor", "-x", "x-", "a--b", "a b"]) assert.equal(isValidSlug(bad), false, bad)
  assert.ok(compareVersions("1.10.0", "1.9.2") > 0)
  assert.ok(compareVersions("v2.0", "2.0.0") === 0)
  assert.ok(compareVersions("1.0.0-beta", "1.0.0") === 0)
  assert.equal(latestVersioned([{ version: "1.2.0" }, { version: "" }, { version: "1.10.0" }, { version: "1.9.0" }])?.version, "1.10.0")
  assert.equal(latestVersioned([{ version: "" }]), null)
})

test("app form validation", () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(entries)) f.set(k, v)
    return f
  }
  assert.ok("error" in readAppForm(form({ name: "" })))
  assert.ok("error" in readAppForm(form({ name: "X", slug: "Bad Slug" })))
  assert.ok("error" in readAppForm(form({ name: "X", default_duration_days: "0" })))
  assert.ok("error" in readAppForm(form({ name: "X", default_max_sites: "abc" })))
  assert.ok("error" in readAppForm(form({ name: "X", default_status: "expired" })))
  const ok = readAppForm(form({ name: "Harbor Theme", default_duration_days: "365", default_max_sites: "3" }))
  assert.ok("input" in ok)
  if ("input" in ok) assert.deepEqual([ok.input.slug, ok.input.default_duration_days, ok.input.default_max_sites], ["harbor-theme", 365, 3])
})

test("apps: unique slug, defaults, summary, delete rules", async () => {
  const { env } = setup()
  const app = await newApp(env)
  assert.deepEqual(await createApp(env, appInput), { error: "Another app already uses this identifier." })
  assert.equal((await findApp(env, "harbor-theme"))!.id, app.id)
  assert.equal((await findApp(env, app.id))!.slug, "harbor-theme")

  const defaults = appDefaults(app, 1_000)
  assert.deepEqual([defaults.status, defaults.max_sites, defaults.expires_at], ["active", 1, 1_000 + 365 * 86_400_000])

  const other = await newApp(env, { name: "Other", slug: "other" })
  assert.ok("error" in (await updateApp(env, other, { ...appInput, slug: "harbor-theme" })))

  await createLicense(env, { ...baseLicense, app_id: app.id })
  await createLicense(env, { ...baseLicense, app_id: app.id, status: "suspended" })
  await createLicense(env, { ...baseLicense, app_id: app.id, expires_at: Date.now() - 1000 })
  const summary = (await getAppSummary(env, "harbor-theme"))!
  assert.deepEqual([summary.licenses, summary.in_force], [3, 1])
  assert.equal((await listApps(env)).length, 2)

  const refused = await deleteApp(env, app)
  assert.ok("error" in refused && /3 licences/.test(refused.error))
  assert.deepEqual(await deleteApp(env, other), { ok: true })
})

test("site limit in the check response", () => {
  const lic = { name: "L", status: "active", expires_at: null, domains: "", message: "", max_sites: 2, app_slug: "harbor-theme", app_name: "Harbor Theme" }
  const now = Date.now()
  assert.equal(buildCheckResponse(lic, "a.com", now, []).valid, true)
  assert.deepEqual(buildCheckResponse(lic, "a.com", now, []).app, { slug: "harbor-theme", name: "Harbor Theme" })
  assert.equal(buildCheckResponse(lic, "b.com", now, ["a.com"]).valid, true)
  assert.equal(buildCheckResponse(lic, "a.com", now, ["a.com", "b.com"]).valid, true) // a known site stays valid
  const full = buildCheckResponse(lic, "c.com", now, ["a.com", "b.com"])
  assert.deepEqual([full.valid, full.status], [false, "site_limit_reached"])
  const noDomain = buildCheckResponse(lic, null, now, [])
  assert.deepEqual([noDomain.valid, noDomain.status], [false, "domain_mismatch"])
  assert.match(noDomain.message, /2 sites/)
  assert.equal(buildCheckResponse({ ...lic, max_sites: null }, null, now, []).valid, true) // no limit: no domain needed
  assert.equal(buildCheckResponse({ ...lic, status: "suspended" }, "c.com", now, ["a.com", "b.com"]).status, "suspended") // status wins
  assert.equal(buildCheckResponse({ ...lic, domains: "a.com" }, "b.com", now, []).status, "domain_mismatch") // the allowed list still applies
})

test("check endpoint registers sites and enforces the limit", async () => {
  const { env, ctx, settle } = setup()
  const lic = await createLicense(env, { ...baseLicense, max_sites: 2 })
  const check = async (domain: string | null) => {
    const res = await handleCheck(new Request(`https://w.dev/check/${lic.license_key}${domain ? `?domain=${domain}` : ""}`), env, ctx, lic.license_key)
    await settle()
    return (await res.json()) as { valid: boolean; status: string }
  }
  assert.equal((await check("a.com")).valid, true)
  assert.equal((await check("www.b.com")).valid, true) // www. is ignored
  assert.equal((await check("a.com")).valid, true)
  const refused = await check("c.com")
  assert.deepEqual([refused.valid, refused.status], [false, "site_limit_reached"])
  assert.equal((await check(null)).status, "domain_mismatch")

  const sites = await listActivations(env, lic.id)
  assert.deepEqual(sites.map((s) => s.domain), ["a.com", "b.com"]) // c.com was refused and not registered
  assert.equal(sites.find((s) => s.domain === "a.com")!.check_count, 2)
  assert.equal((await getLicense(env, lic.id))!.sites_used, 2)

  // releasing a site frees its slot
  assert.equal(await releaseActivation(env, (await getLicense(env, lic.id))!, "b.com"), true)
  assert.equal(await releaseActivation(env, (await getLicense(env, lic.id))!, "b.com"), false)
  assert.equal((await check("c.com")).valid, true)
})

test("the limit is enforced by the insert itself", async () => {
  const { env } = setup()
  const lic = await createLicense(env, { ...baseLicense, max_sites: 1 })
  await Promise.all(["a.com", "b.com", "c.com"].map((d) => recordActivation(env, lic, d, Date.now())))
  assert.equal((await listActivations(env, lic.id)).length, 1)
})

test("licences without a limit are not restricted but sites are still listed", async () => {
  const { env, ctx, settle } = setup()
  const lic = await createLicense(env, baseLicense)
  for (const d of ["a.com", "b.com", "c.com"]) {
    const res = await handleCheck(new Request(`https://w.dev/check/${lic.license_key}?domain=${d}`), env, ctx, lic.license_key)
    assert.equal(((await res.json()) as { valid: boolean }).valid, true)
  }
  await settle()
  assert.equal((await listActivations(env, lic.id)).length, 3)
})

test("app files are shared by the licences of the app", async () => {
  const { env, objects, ctx, settle } = setup()
  const app = await newApp(env, { default_max_sites: null })
  const other = await newApp(env, { name: "Other", slug: "other", default_max_sites: null })
  const a = await createLicense(env, { ...baseLicense, app_id: app.id })
  const b = await createLicense(env, { ...baseLicense, app_id: app.id })
  const outsider = await createLicense(env, { ...baseLicense, app_id: other.id })
  const standalone = await createLicense(env, baseLicense)

  const up = async (name: string, version: string, statuses = "active,completed") => {
    const res = await storeFile(env, { app }, { name, version, statuses, checkDomain: false, size: name.length, body: body(name) })
    assert.ok("file" in res)
    return (res as { file: { id: string } }).file
  }
  const v1 = await up("theme-1.9.0.zip", "1.9.0")
  const v2 = await up("theme-1.10.0.zip", "1.10.0")
  const gated = await up("theme-2.0.0-beta.zip", "2.0.0", "completed")
  assert.equal(objects.size, 3)
  await storeFile(env, { license: a }, { name: "custom.zip", checkDomain: false, size: 6, body: body("custom") }) // a licence's own file

  const get = async (license: typeof a, path = "") => {
    const res = await handleDownload(new Request(`https://w.dev/download/${license.license_key}${path}`), env, ctx, license.license_key, path ? path.slice(1) : null)
    await settle()
    return res
  }

  const listA = (await (await get(a)).json()) as any
  assert.deepEqual(listA.files.map((f: any) => [f.name, f.source, f.available]).sort(), [["custom.zip", "licence", true], ["theme-1.10.0.zip", "app", true], ["theme-1.9.0.zip", "app", true], ["theme-2.0.0-beta.zip", "app", false]])
  assert.equal(listA.latest.version, "1.10.0") // 2.0.0 is not available to an active licence, so it is not offered as the latest
  assert.deepEqual(listA.app, { slug: "harbor-theme", name: "Harbor Theme" })

  const listB = (await (await get(b)).json()) as any
  assert.equal(listB.files.length, 3) // b does not see a's own file
  assert.equal((await (await get(outsider)).json() as any).files.length, 0)
  assert.equal((await (await get(standalone)).json() as any).files.length, 0)

  assert.equal(await (await get(a, `/${v2.id}`)).text(), "theme-1.10.0.zip")
  assert.equal(await (await get(b, `/${v2.id}`)).text(), "theme-1.10.0.zip")
  assert.equal((await get(outsider, `/${v2.id}`)).status, 404) // another app's licence cannot reach it
  assert.equal((await get(a, `/${gated.id}`)).status, 403)
  assert.equal((await getFile(env, { app }, v2.id))!.download_count, 2) // downloads by both licences are counted on the shared file

  const log = (await env.DB.prepare("SELECT detail FROM activity WHERE license_id = ? AND event = 'download'").bind(a.id).all<{ detail: string }>()).results.map((r) => r.detail).join("|")
  assert.match(log, /Downloaded: theme-1.10.0.zip/)
  assert.match(log, /Download refused: theme-2.0.0-beta.zip/)

  // deleting a licence keeps the app's files; deleting a shared file removes the stored object
  await deleteLicense(env, a.id)
  assert.equal((await listFiles(env, { app })).length, 3)
  assert.equal(objects.size, 3)
  await deleteFile(env, { app }, (await getFile(env, { app }, v1.id))!)
  assert.equal(objects.size, 2)
})

test("downloads respect the site limit of the licence", async () => {
  const { env, ctx, settle } = setup()
  const app = await newApp(env)
  const lic = await createLicense(env, { ...baseLicense, app_id: app.id, max_sites: 1 })
  const file = (await storeFile(env, { app }, { name: "t.zip", size: 1, body: body("x"), checkDomain: true })) as { file: { id: string } }
  const download = async (domain: string | null) => {
    const res = await handleDownload(new Request(`https://w.dev/download/${lic.license_key}/${file.file.id}${domain ? `?domain=${domain}` : ""}`), env, ctx, lic.license_key, file.file.id)
    await settle()
    return res
  }
  assert.equal((await download("a.com")).status, 200) // room for one site
  await recordActivation(env, lic, "a.com", Date.now())
  assert.equal((await download("a.com")).status, 200)
  const refused = await download("b.com")
  assert.equal(refused.status, 403)
  assert.equal(((await refused.json()) as any).status, "site_limit_reached")
  assert.equal((await download(null)).status, 403) // a domain is required when there is a limit
})

test("deleting an app removes its stored files", async () => {
  const { env, objects } = setup()
  const app = await newApp(env)
  await storeFile(env, { app }, { name: "t.zip", size: 1, body: body("x") })
  assert.equal(objects.size, 1)
  assert.deepEqual(await deleteApp(env, app), { ok: true })
  assert.equal(objects.size, 0)
  assert.equal(await findApp(env, app.id), null)
})

test("licences can be filtered by app", async () => {
  const { env } = setup()
  const app = await newApp(env)
  await createLicense(env, { ...baseLicense, name: "In app", app_id: app.id })
  await createLicense(env, { ...baseLicense, name: "Standalone" })
  assert.deepEqual((await queryLicenses(env, { appId: app.id, limit: 10 })).map((l) => l.name), ["In app"])
  assert.equal((await queryLicenses(env, { q: "harbor theme", limit: 10 })).length, 1) // searching also matches the app name
  assert.equal((await queryLicenses(env, { limit: 10 })).length, 2)
})
