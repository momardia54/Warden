import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { addToSet, COLOR_PRESETS, DEFAULT_STATUSES, defaultStatusKey, effectiveStatusKey, grantsAccess, isColor, isValidKey, keyFromLabel, moveInSet, parseStatusDraft, removeFromSet, updateInSet, validateStatusSet } from "../app/lib/statuses.ts"
import { buildCheckResponse } from "../app/lib/license.ts"
import { createApp, readAppForm } from "../app/server/apps.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { handleDownload } from "../app/server/download.server.ts"
import { getFile, storeFile } from "../app/server/files.server.ts"
import { createLicense, deleteLicense, getLicense, queryLicenses, readLicenseForm, setStatus, updateLicense, type LicenseInput } from "../app/server/licenses.server.ts"
import {
  createStatus, customizeStatuses, deleteStatus, getStatusSetForApp, getStatusSetForLicense, hasCustomSet, loadStatusSets, moveStatus, resetStatuses, setForLicense,
  saveStatusSet, setStatusOrder, statusCounts, statusSource, statusUsage, updateStatus,
} from "../app/server/statuses.server.ts"

const DAY = 86_400_000
const license: LicenseInput = { name: "L", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }
const input = { description: "", color: "#16a34a", grants_access: true, on_expiry: null, check_message: "" }

function setup() {
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  return { env, objects, ctx, settle }
}
const body = (text: string) => new Response(text).body
async function newApp(env: Env, name = "Harbor Theme", slug = "harbor-theme") {
  const created = await createApp(env, { name, slug, description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })
  return (created as { app: { id: string } }).app
}

test("keys, colours and sets are validated", () => {
  assert.equal(keyFromLabel("Trial period!"), "trial_period")
  assert.equal(keyFromLabel("  Café Ünïcode "), "cafe_unicode")
  assert.equal(keyFromLabel("123 go"), "go")
  for (const key of ["trial", "a1", "grace_period"]) assert.equal(isValidKey(key), true, key)
  for (const key of ["", "1a", "Trial", "a-b", "unknown", "domain_mismatch", "site_limit_reached", "x".repeat(33)]) assert.equal(isValidKey(key), false, key)

  for (const c of ["#16a34a", "#FFFFFF", "#000000"]) assert.equal(isColor(c), true, c)
  for (const c of ["red", "#fff", "16a34a", "#16a34a0", "#gggggg", "", 5]) assert.equal(isColor(c), false, String(c))
  assert.ok(COLOR_PRESETS.length >= 6 && COLOR_PRESETS.every((p) => isColor(p.value)))

  assert.equal(validateStatusSet(DEFAULT_STATUSES), null)
  assert.match(validateStatusSet([])!, /At least one/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => ({ ...s, is_default: false })))!, /default/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => ({ ...s, is_default: true })))!, /default/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => (s.key === "active" ? { ...s, on_expiry: "nowhere" } : s)))!, /expiry rule/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => (s.key === "active" ? { ...s, color: "green" } : s)))!, /colour/)
  assert.match(validateStatusSet([...DEFAULT_STATUSES, { ...DEFAULT_STATUSES[0] }])!, /twice/)
})

test("expiry rules decide the status sites see", () => {
  const now = Date.now()
  const set = [
    { ...DEFAULT_STATUSES[1], key: "trial", label: "Trial", on_expiry: "trial_ended", is_default: false },
    { ...DEFAULT_STATUSES[0], key: "trial_ended", label: "Trial ended", is_default: false },
    { ...DEFAULT_STATUSES[1], key: "paid", label: "Paid", on_expiry: null, is_default: true },
  ]
  assert.equal(effectiveStatusKey({ status: "trial", expires_at: now - 1 }, set, now), "trial_ended")
  assert.equal(effectiveStatusKey({ status: "trial", expires_at: now + DAY }, set, now), "trial")
  assert.equal(effectiveStatusKey({ status: "paid", expires_at: now - DAY }, set, now), "paid")
  assert.equal(defaultStatusKey(set), "paid")
  assert.equal(grantsAccess(set, "trial_ended"), false)
  assert.equal(grantsAccess(set, "missing"), false)
  const response = buildCheckResponse({ name: "L", status: "trial", expires_at: now - 1, domains: "", message: "" }, null, now, [], set)
  assert.deepEqual([response.valid, response.status], [false, "trial_ended"])
})

test("everything starts with the built-in defaults", async () => {
  const { env } = setup()
  const app = await newApp(env)
  const lic = await createLicense(env, license)
  assert.deepEqual(DEFAULT_STATUSES.map((s) => s.key), ["pending", "active", "completed", "suspended", "disabled", "expired"])
  assert.deepEqual(DEFAULT_STATUSES.map((s) => s.grants_access), [false, true, true, false, false, false])
  assert.equal(await getStatusSetForApp(env, null), DEFAULT_STATUSES)
  assert.equal(await getStatusSetForApp(env, app.id), DEFAULT_STATUSES)
  assert.equal(await getStatusSetForLicense(env, lic), DEFAULT_STATUSES)
  assert.deepEqual(await loadStatusSets(env), { byApp: {}, byLicense: {} })
  assert.equal(await hasCustomSet(env, { app: app.id }), false)
  assert.equal(await statusSource(env, lic), "default")
})

test("an app can customise its statuses", async () => {
  const { env } = setup()
  const app = await newApp(env)
  assert.ok("error" in (await createStatus(env, { app: app.id }, { ...input, label: "Trial" }))) // customise first
  const copy = await customizeStatuses(env, { app: app.id })
  assert.ok("set" in copy)
  assert.deepEqual((copy as { set: { key: string }[] }).set.map((s) => s.key), DEFAULT_STATUSES.map((s) => s.key))
  assert.ok("error" in (await customizeStatuses(env, { app: app.id })))

  assert.ok("set" in (await createStatus(env, { app: app.id }, { ...input, label: "Free trial", color: "#0284c7", on_expiry: "expired" })))
  assert.ok("error" in (await createStatus(env, { app: app.id }, { ...input, label: "Active" }))) // duplicate key
  assert.ok("error" in (await createStatus(env, { app: app.id }, { ...input, label: "Unknown" }))) // reserved
  assert.ok("error" in (await createStatus(env, { app: app.id }, { ...input, label: "Odd", color: "blue" })))
  assert.ok("error" in (await createStatus(env, { app: app.id }, { ...input, label: "Loop", on_expiry: "nowhere" })))

  await updateStatus(env, { app: app.id }, "suspended", { label: "On hold", color: "#7c3aed", grants_access: true })
  let set = await getStatusSetForApp(env, app.id)
  assert.deepEqual([set.find((s) => s.key === "suspended")!.label, set.find((s) => s.key === "suspended")!.color, set.find((s) => s.key === "free_trial")!.color], ["On hold", "#7c3aed", "#0284c7"])

  await updateStatus(env, { app: app.id }, "pending", { is_default: true })
  set = await getStatusSetForApp(env, app.id)
  assert.deepEqual(set.filter((s) => s.is_default).map((s) => s.key), ["pending"])

  await moveStatus(env, { app: app.id }, "expired", "up")
  assert.deepEqual((await getStatusSetForApp(env, app.id)).map((s) => s.key).slice(4, 6), ["expired", "disabled"])
  const keys = (await getStatusSetForApp(env, app.id)).map((s) => s.key).reverse()
  assert.ok("set" in (await setStatusOrder(env, { app: app.id }, keys)))
  assert.ok("error" in (await setStatusOrder(env, { app: app.id }, keys.slice(1))))

  // another app and the defaults are not affected
  const other = await newApp(env, "Other", "other")
  assert.equal(await getStatusSetForApp(env, other.id), DEFAULT_STATUSES)
  assert.equal(DEFAULT_STATUSES.find((s) => s.key === "suspended")!.label, "Suspended")
})

test("a licence in an app uses the app's statuses; a standalone licence can have its own", async () => {
  const { env } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  await createStatus(env, { app: app.id }, { ...input, label: "Trial", on_expiry: "expired" })

  const standalone = await createLicense(env, license)
  const inApp = await createLicense(env, { ...license, app_id: app.id, status: "trial" })
  const plainApp = await createLicense(env, license)

  assert.equal(await statusSource(env, standalone), "default")
  assert.equal(await statusSource(env, inApp), "app")
  assert.equal((await getStatusSetForLicense(env, inApp)).some((s) => s.key === "trial"), true)
  assert.equal((await getStatusSetForLicense(env, standalone)).some((s) => s.key === "trial"), false)

  // a licence in an app cannot have statuses of its own
  const refused = await customizeStatuses(env, { license: inApp.id })
  assert.ok("error" in refused && /belongs to an app/.test(refused.error))
  assert.equal(await hasCustomSet(env, { license: inApp.id }), false)

  // a standalone licence customises its own: a copy of the defaults, then free to change
  const copy = await customizeStatuses(env, { license: standalone.id })
  assert.deepEqual((copy as { set: { key: string }[] }).set.map((s) => s.key), DEFAULT_STATUSES.map((s) => s.key))
  await createStatus(env, { license: standalone.id }, { ...input, label: "Beta", color: "#db2777" })
  await updateStatus(env, { license: standalone.id }, "pending", { label: "Waiting" })
  assert.equal(await statusSource(env, standalone), "licence")
  const sets = await loadStatusSets(env)
  assert.equal(setForLicense(sets, standalone).some((s) => s.key === "beta"), true)
  assert.equal(setForLicense(sets, inApp).some((s) => s.key === "beta"), false)
  assert.equal(setForLicense(sets, plainApp).some((s) => s.key === "beta"), false) // other standalone licences keep the defaults
  assert.equal(DEFAULT_STATUSES.find((s) => s.key === "pending")!.label, "Pending")
  await setStatus(env, (await getLicense(env, standalone.id))!, "beta")
  assert.equal((await getLicense(env, standalone.id))!.status, "beta")

  // joining an app: the licence's own statuses are discarded and the app's apply
  await updateLicense(env, (await getLicense(env, standalone.id))!, { ...license, app_id: app.id, status: "trial" })
  assert.equal(await hasCustomSet(env, { license: standalone.id }), false)
  assert.equal(await statusSource(env, (await getLicense(env, standalone.id))!), "app")
  assert.equal((await getStatusSetForLicense(env, (await getLicense(env, standalone.id))!)).some((s) => s.key === "beta"), false)
})

test("the check uses the statuses that apply to the licence", async () => {
  const { env, ctx, settle } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  await createStatus(env, { app: app.id }, { ...input, label: "Trial", on_expiry: "expired", check_message: "Trial running." })
  await createStatus(env, { app: app.id }, { ...input, label: "Refunded", grants_access: false, check_message: "This licence was refunded." })

  const trial = await createLicense(env, { ...license, app_id: app.id, status: "trial", expires_at: Date.now() + DAY })
  const refunded = await createLicense(env, { ...license, app_id: app.id, status: "refunded" })
  const standalone = await createLicense(env, license)
  const own = await createLicense(env, license)
  await customizeStatuses(env, { license: own.id })
  await createStatus(env, { license: own.id }, { ...input, label: "Paused", grants_access: false, check_message: "This licence is paused." })
  await setStatus(env, (await getLicense(env, own.id))!, "paused")

  const check = async (l: { license_key: string }) => {
    const res = await handleCheck(new Request(`https://w.dev/check/${l.license_key}`), env, ctx, l.license_key)
    await settle()
    return (await res.json()) as { valid: boolean; status: string; message: string }
  }
  assert.deepEqual(await check(trial).then((r) => [r.valid, r.status, r.message]), [true, "trial", "Trial running."])
  assert.deepEqual(await check(refunded).then((r) => [r.valid, r.status, r.message]), [false, "refunded", "This licence was refunded."])
  assert.equal((await check(standalone)).valid, true)
  assert.deepEqual(await check(own).then((r) => [r.valid, r.status, r.message]), [false, "paused", "This licence is paused."])
})

test("filtering by status follows each licence's own statuses", async () => {
  const { env } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  await createStatus(env, { app: app.id }, { ...input, label: "Trial", on_expiry: "expired" })
  const trial = await createLicense(env, { ...license, app_id: app.id, status: "trial", expires_at: Date.now() - 1000 })
  const active = await createLicense(env, license)
  const own = await createLicense(env, license)
  await customizeStatuses(env, { license: own.id })
  await createStatus(env, { license: own.id }, { ...input, label: "Beta", on_expiry: "expired" })
  await updateLicense(env, own, { ...license, status: "beta", expires_at: Date.now() - 1000 })

  const ids = async (status: string) => (await queryLicenses(env, { status, limit: 10 })).map((l) => l.id).sort()
  assert.deepEqual(await ids("expired"), [trial.id, own.id].sort()) // each licence's expiry rule leads to Expired
  assert.deepEqual(await ids("active"), [active.id])
  assert.deepEqual(await ids("trial"), [])
  assert.deepEqual(await ids("beta"), [])
  assert.deepEqual(await ids("nonexistent"), [])
})

test("deleting a status that is in use needs a replacement", async () => {
  const { env } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  const a = await createLicense(env, { ...license, app_id: app.id, status: "suspended" })
  const b = await createLicense(env, { ...license, app_id: app.id, status: "suspended" })
  const standalone = await createLicense(env, { ...license, status: "suspended" }) // uses the defaults, so the app's edits do not touch it
  const file = (await storeFile(env, { app }, { name: "notice.html", statuses: "suspended,expired", size: 1, body: body("x"), checkDomain: false })) as { file: { id: string } }

  assert.deepEqual(await statusUsage(env, { app: app.id }, "suspended"), { licenses: 2, files: 1 })
  assert.deepEqual(await statusCounts(env, { app: app.id }), { suspended: 2 })
  assert.match((await deleteStatus(env, { app: app.id }, "suspended", null) as { error: string }).error, /2 licences/)
  assert.ok("error" in (await deleteStatus(env, { app: app.id }, "suspended", "suspended")))
  assert.ok("error" in (await deleteStatus(env, { app: app.id }, "suspended", "missing")))

  assert.ok("set" in (await deleteStatus(env, { app: app.id }, "suspended", "disabled")))
  assert.equal((await getLicense(env, a.id))!.status, "disabled")
  assert.equal((await getLicense(env, b.id))!.status, "disabled")
  assert.equal((await getLicense(env, standalone.id))!.status, "suspended")
  assert.equal((await getFile(env, { app }, file.file.id))!.statuses, "expired,disabled")
  assert.equal((await getStatusSetForApp(env, app.id)).some((s) => s.key === "suspended"), false)
  assert.equal((await getStatusSetForLicense(env, standalone)).some((s) => s.key === "suspended"), true)

  // the same for a standalone licence's own statuses
  await customizeStatuses(env, { license: standalone.id })
  assert.deepEqual(await statusUsage(env, { license: standalone.id }, "suspended"), { licenses: 1, files: 0 })
  assert.ok("set" in (await deleteStatus(env, { license: standalone.id }, "suspended", "pending")))
  assert.equal((await getLicense(env, standalone.id))!.status, "pending")
})

test("deleting a status clears expiry rules that pointed to it, and a set keeps one status", async () => {
  const { env } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  assert.ok("set" in (await deleteStatus(env, { app: app.id }, "expired", null)))
  assert.equal((await getStatusSetForApp(env, app.id)).find((s) => s.key === "active")!.on_expiry, null)
  for (const key of ["pending", "completed", "disabled", "suspended"]) assert.ok("set" in (await deleteStatus(env, { app: app.id }, key, null)), key)
  assert.match(((await deleteStatus(env, { app: app.id }, "active", null)) as { error: string }).error, /at least one/i)
})

test("going back to the default statuses", async () => {
  const { env } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  await createStatus(env, { app: app.id }, { ...input, label: "Trial" })
  const inApp = await createLicense(env, { ...license, app_id: app.id, status: "trial" })
  const solo = await createLicense(env, license)
  await customizeStatuses(env, { license: solo.id })
  await createStatus(env, { license: solo.id }, { ...input, label: "Gold" })
  await setStatus(env, (await getLicense(env, solo.id))!, "gold")

  // the standalone licence returns to the defaults: "gold" does not exist there
  const refusal = await resetStatuses(env, { license: solo.id })
  assert.ok("error" in refusal && /Gold/.test(refusal.error))
  assert.deepEqual(await resetStatuses(env, { license: solo.id }, { gold: "completed" }), { ok: true })
  assert.equal((await getLicense(env, solo.id))!.status, "completed")
  assert.equal(await statusSource(env, solo), "default")

  // the app returns to the defaults: "trial" does not exist there
  assert.ok("error" in (await resetStatuses(env, { app: app.id })))
  assert.deepEqual(await resetStatuses(env, { app: app.id }, { trial: "active" }), { ok: true })
  assert.equal((await getLicense(env, inApp.id))!.status, "active")
  assert.equal(await getStatusSetForApp(env, app.id), DEFAULT_STATUSES)
})

test("deleting a licence or an app removes its statuses", async () => {
  const { env } = setup()
  const app = await newApp(env)
  const lic = await createLicense(env, license)
  await customizeStatuses(env, { license: lic.id })
  await customizeStatuses(env, { app: app.id })
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS c FROM statuses").first<{ c: number }>())!.c, 12)
  await deleteLicense(env, lic.id)
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS c FROM statuses").first<{ c: number }>())!.c, 6)
})

test("app files are released by the app's statuses to licences with their own statuses", async () => {
  const { env, ctx, settle } = setup()
  const app = await newApp(env)
  await customizeStatuses(env, { app: app.id })
  await createStatus(env, { app: app.id }, { ...input, label: "Trial", on_expiry: "expired" })
  const file = (await storeFile(env, { app }, { name: "theme.zip", statuses: "trial", size: 5, body: body("hello"), checkDomain: false })) as { file: { id: string } }
  const trial = await createLicense(env, { ...license, app_id: app.id, status: "trial" })
  const active = await createLicense(env, { ...license, app_id: app.id })
  const download = async (l: typeof trial) => {
    const res = await handleDownload(new Request(`https://w.dev/download/${l.license_key}/${file.file.id}`), env, ctx, l.license_key, file.file.id)
    await settle()
    return res
  }
  assert.equal((await download(trial)).status, 200)
  const refused = await download(active)
  assert.equal(refused.status, 403)
  assert.match(((await refused.json()) as { message: string }).message, /Trial/) // the message names the app's status
})

test("API: statuses of apps and licences", async () => {
  const { env } = setup()
  const manage = (await createApiKey(env, "m", "manage")).secret
  const full = (await createApiKey(env, "f", "full")).secret
  const read = (await createApiKey(env, "r", "read")).secret
  const { ctx } = makeCtx()
  const call = async (method: string, path: string, key: string, payload?: unknown) => {
    const res = await handleApi(new Request(`https://w.dev/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) }), env, ctx)
    return { status: res.status, json: (await res.json()) as any }
  }

  // the defaults are read-only
  const defaults = await call("GET", "/statuses", read)
  assert.equal(defaults.json.data.length, 6)
  assert.deepEqual(Object.keys(defaults.json.data[0]).sort(), ["check_message", "color", "description", "grants_access", "is_default", "key", "label", "on_expiry"])
  assert.equal((await call("POST", "/statuses", manage, { label: "x" })).status, 404)

  // app level
  const app = (await call("POST", "/apps", manage, { name: "Harbor Theme" })).json
  assert.deepEqual(await call("GET", "/apps/harbor-theme/statuses", read).then((r) => [r.json.custom, r.json.source, r.json.data.length]), [false, "default", 6])
  assert.equal((await call("POST", "/apps/harbor-theme/statuses", manage, { label: "Trial" })).json.error.code, "statuses_not_customized")
  assert.equal((await call("POST", "/apps/harbor-theme/statuses/customize", read)).status, 403)
  assert.equal((await call("POST", "/apps/harbor-theme/statuses/customize", manage)).status, 201)
  assert.equal((await call("POST", "/apps/harbor-theme/statuses/customize", manage)).status, 409)
  const trial = await call("POST", "/apps/harbor-theme/statuses", manage, { label: "Trial", color: "#0284c7", grants_access: true, on_expiry: "expired", check_message: "Trial running." })
  assert.deepEqual([trial.status, trial.json.key, trial.json.color, trial.json.grants_access], [201, "trial", "#0284c7", true])
  assert.equal((await call("POST", "/apps/harbor-theme/statuses", manage, { label: "Bad", color: "blue" })).status, 422)
  assert.equal((await call("POST", "/apps/harbor-theme/statuses", manage, { label: "Trial" })).status, 422) // duplicate
  assert.equal((await call("PATCH", "/apps/harbor-theme/statuses/trial", manage, { color: "#7C3AED" })).json.color, "#7c3aed")

  const lic = (await call("POST", "/apps/harbor-theme/licenses", manage, { name: "T", status: "trial", duration_days: 14 })).json
  assert.deepEqual([lic.status, lic.valid], ["trial", true])
  assert.equal((await call("POST", "/licenses", manage, { name: "S", status: "trial" })).json.error.code, "invalid_status") // a standalone licence uses the defaults
  assert.equal((await call("PATCH", "/apps/harbor-theme", manage, { default_status: "trial" })).json.default_status, "trial")

  // a licence in an app uses the app's statuses: readable, but changed on the app
  assert.deepEqual(await call("GET", `/licenses/${lic.id}/statuses`, read).then((r) => [r.json.custom, r.json.source, r.json.data.some((x: any) => x.key === "trial")]), [false, "app", true])
  assert.equal((await call("POST", `/licenses/${lic.id}/statuses/customize`, manage)).json.error.code, "license_in_app")
  assert.equal((await call("POST", `/licenses/${lic.id}/statuses`, manage, { label: "Gold" })).json.error.code, "license_in_app")

  // a standalone licence can have its own statuses
  const solo = (await call("POST", "/licenses", manage, { name: "Solo" })).json
  assert.deepEqual(await call("GET", `/licenses/${solo.id}/statuses`, read).then((r) => [r.json.custom, r.json.source]), [false, "default"])
  assert.equal((await call("POST", `/licenses/${solo.id}/statuses`, manage, { label: "Gold" })).json.error.code, "statuses_not_customized")
  assert.equal((await call("POST", `/licenses/${solo.id}/statuses/customize`, manage)).status, 201)
  assert.deepEqual(await call("GET", `/licenses/${solo.id}/statuses`, read).then((r) => [r.json.custom, r.json.source]), [true, "licence"])
  assert.equal((await call("POST", `/licenses/${solo.id}/statuses`, manage, { label: "Gold", color: "#d97706", grants_access: true })).status, 201)
  assert.equal((await call("POST", `/licenses/${solo.id}/status`, manage, { status: "gold" })).json.status, "gold")
  assert.equal((await call("POST", "/licenses", manage, { name: "Other", status: "gold" })).json.error.code, "invalid_status") // another standalone licence uses the defaults
  assert.equal((await call("DELETE", `/licenses/${solo.id}/statuses/gold`, full)).json.error.code, "status_in_use")
  assert.equal((await call("DELETE", `/licenses/${solo.id}/statuses/gold?move_to=active`, full)).status, 200)
  assert.equal((await call("POST", `/licenses/${solo.id}/statuses/order`, manage, { keys: ["active"] })).status, 422)
  assert.equal((await call("DELETE", `/licenses/${solo.id}/statuses`, manage, {})).status, 403)
  assert.equal((await call("DELETE", `/licenses/${solo.id}/statuses`, full, {})).json.custom, false)

  // joining an app discards the licence's own statuses
  await call("POST", `/licenses/${solo.id}/statuses/customize`, manage)
  assert.equal((await call("PATCH", `/licenses/${solo.id}`, manage, { app: "harbor-theme" })).json.app.slug, "harbor-theme")
  assert.equal((await call("GET", `/licenses/${solo.id}/statuses`, read).then((r) => r.json.source)), "app")

  // back to the defaults
  void app
  assert.equal((await call("GET", "/stats", read)).json.by_status.active >= 1, true)
})

test("a set can be edited in memory without changing the original", () => {
  const original = DEFAULT_STATUSES
  const snapshot = JSON.stringify(original)
  const added = addToSet(original, { label: "Trial", description: "", color: "#0284c7", grants_access: true, on_expiry: "expired", check_message: "" })
  assert.ok("set" in added)
  const withTrial = (added as { set: typeof original }).set
  assert.deepEqual([withTrial.length, withTrial[withTrial.length - 1].key, withTrial[withTrial.length - 1].position], [7, "trial", 7])
  assert.ok("error" in addToSet(withTrial, { label: "Trial", description: "", color: "#0284c7", grants_access: true, on_expiry: null, check_message: "" }))
  assert.ok("error" in addToSet(original, { label: "x", description: "", color: "red", grants_access: true, on_expiry: null, check_message: "" }))

  const renamed = updateInSet(withTrial, "trial", { label: "Free trial", is_default: true }) as { set: typeof original }
  assert.deepEqual([renamed.set.find((st) => st.key === "trial")!.label, renamed.set.filter((st) => st.is_default).map((st) => st.key)], ["Free trial", ["trial"]])
  assert.ok("error" in updateInSet(withTrial, "missing", { label: "x" }))

  const removed = removeFromSet(withTrial, "expired") as { set: typeof original }
  assert.equal(removed.set.find((st) => st.key === "active")!.on_expiry, null) // the rule that pointed to Expired is cleared
  assert.ok("error" in removeFromSet([withTrial[0]], withTrial[0].key))
  assert.deepEqual(moveInSet(original, "pending", "down").slice(0, 2).map((st) => st.key), ["active", "pending"])
  assert.equal(moveInSet(original, "pending", "up"), original) // already first

  assert.equal(JSON.stringify(original), snapshot) // the originals were not modified
})

test("a set drafted in a create form is validated and stored with the new item", async () => {
  const draft = (changes: object[] = []) => JSON.stringify([...DEFAULT_STATUSES, ...changes])
  const extra = { key: "trial", label: "Trial", description: "", color: "#0284c7", grants_access: true, on_expiry: "expired", check_message: "", is_default: false }
  assert.ok("set" in parseStatusDraft(draft([extra])))
  assert.ok("error" in parseStatusDraft("not json"))
  assert.ok("error" in parseStatusDraft(JSON.stringify({ not: "an array" })))
  assert.ok("error" in parseStatusDraft(draft([{ ...extra, color: "blue" }])))
  assert.ok("error" in parseStatusDraft(draft([{ ...extra, is_default: true }]))) // two defaults
  assert.ok("error" in parseStatusDraft(draft([{ ...extra, on_expiry: "nowhere" }])))
  assert.ok("error" in parseStatusDraft(draft([{ ...extra, key: "unknown" }])))
  assert.ok("error" in parseStatusDraft("[]"))

  const { env } = setup()
  const parsed = parseStatusDraft(draft([extra])) as { set: typeof DEFAULT_STATUSES }
  const form = (entries: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(entries)) f.set(k, v)
    return f
  }

  // the licence form accepts a status that only exists in the draft
  assert.ok("error" in readLicenseForm(form({ name: "L", status: "trial" }), { byApp: {}, byLicense: {} }))
  const ok = readLicenseForm(form({ name: "L", status: "trial" }), { byApp: {}, byLicense: {} }, "", parsed.set)
  assert.ok("input" in ok)
  const lic = await createLicense(env, (ok as { input: LicenseInput }).input)
  assert.deepEqual(await saveStatusSet(env, { license: lic.id }, parsed.set), { ok: true })
  assert.equal(await statusSource(env, lic), "licence")
  assert.equal((await getStatusSetForLicense(env, lic)).some((st) => st.key === "trial"), true)
  assert.equal((await getLicense(env, lic.id))!.status, "trial")

  // the app form validates its default status against the draft
  assert.ok("error" in readAppForm(form({ name: "App", default_status: "trial" }), DEFAULT_STATUSES))
  const app = readAppForm(form({ name: "App", default_status: "trial" }), parsed.set)
  assert.ok("input" in app)
  const created = (await createApp(env, (app as { input: Parameters<typeof createApp>[1] }).input)) as { app: { id: string } }
  assert.deepEqual(await saveStatusSet(env, { app: created.app.id }, parsed.set), { ok: true })
  assert.equal((await getStatusSetForApp(env, created.app.id)).some((st) => st.key === "trial"), true)
  assert.ok("error" in (await saveStatusSet(env, { app: created.app.id }, [])))
})
