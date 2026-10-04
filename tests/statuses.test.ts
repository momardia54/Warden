import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { DEFAULT_STATUSES, defaultStatusKey, effectiveStatusKey, grantsAccess, isValidKey, keyFromLabel, validateStatusSet } from "../app/lib/statuses.ts"
import { buildCheckResponse } from "../app/lib/license.ts"
import { createApp } from "../app/server/apps.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { getFile, storeFile } from "../app/server/files.server.ts"
import { createLicense, getLicense, queryLicenses, setStatus, type LicenseInput } from "../app/server/licenses.server.ts"
import {
  createStatus, customizeAppStatuses, deleteStatus, getStatusSet, loadStatusSets, moveStatus, resetAppStatuses, setFor, setStatusOrder, statusCounts, statusUsage, updateStatus,
} from "../app/server/statuses.server.ts"

const DAY = 86_400_000
const license: LicenseInput = { name: "L", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }
const input = { description: "", tone: "success" as const, grants_access: true, on_expiry: null, check_message: "" }

function setup() {
  const { bucket, objects } = makeBucket()
  const env = { DB: makeDb().DB, FILES: bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  return { env, objects, ctx, settle }
}
const body = (text: string) => new Response(text).body

test("keys and sets are validated", () => {
  assert.equal(keyFromLabel("Trial period!"), "trial_period")
  assert.equal(keyFromLabel("  Café Ünïcode "), "cafe_unicode")
  assert.equal(keyFromLabel("123 go"), "go")
  for (const key of ["trial", "a1", "grace_period"]) assert.equal(isValidKey(key), true, key)
  for (const key of ["", "1a", "Trial", "a-b", "unknown", "domain_mismatch", "site_limit_reached", "x".repeat(33)]) assert.equal(isValidKey(key), false, key)

  assert.equal(validateStatusSet(DEFAULT_STATUSES), null)
  assert.match(validateStatusSet([])!, /At least one/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => ({ ...s, is_default: false })))!, /default/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => ({ ...s, is_default: true })))!, /default/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => (s.key === "active" ? { ...s, on_expiry: "nowhere" } : s)))!, /expiry rule/)
  assert.match(validateStatusSet(DEFAULT_STATUSES.map((s) => (s.key === "active" ? { ...s, on_expiry: "active" } : s)))!, /expiry rule/)
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
  assert.equal(effectiveStatusKey({ status: "paid", expires_at: now - DAY }, set, now), "paid") // no rule: the expiry date does not apply
  assert.equal(defaultStatusKey(set), "paid")
  assert.equal(grantsAccess(set, "trial_ended"), false)
  assert.equal(grantsAccess(set, "missing"), false)
  const response = buildCheckResponse({ name: "L", status: "trial", expires_at: now - 1, domains: "", message: "" }, null, now, [], set)
  assert.deepEqual([response.valid, response.status], [false, "trial_ended"])
})

test("the default statuses are seeded", async () => {
  const { env } = setup()
  const sets = await loadStatusSets(env)
  assert.deepEqual(sets.default.map((s) => s.key), ["pending", "active", "completed", "suspended", "disabled", "expired"])
  assert.deepEqual(sets.default.map((s) => s.grants_access), [false, true, true, false, false, false])
  assert.equal(defaultStatusKey(sets.default), "active")
  assert.deepEqual(sets.default.find((s) => s.key === "active")!.on_expiry, "expired")
  assert.deepEqual(sets.byApp, {})
})

test("statuses can be added, changed and reordered", async () => {
  const { env } = setup()
  const created = await createStatus(env, null, { ...input, label: "Grace period", on_expiry: "expired" })
  assert.ok("set" in created)
  const grace = (await getStatusSet(env, null)).find((s) => s.key === "grace_period")!
  assert.deepEqual([grace.label, grace.grants_access, grace.on_expiry], ["Grace period", true, "expired"])

  assert.ok("error" in (await createStatus(env, null, { ...input, label: "Active" }))) // duplicate key
  assert.ok("error" in (await createStatus(env, null, { ...input, label: "Unknown" }))) // reserved
  assert.ok("error" in (await createStatus(env, null, { ...input, label: "x", key: "Bad Key" })))
  assert.ok("error" in (await createStatus(env, null, { ...input, label: "Loop", on_expiry: "nowhere" })))

  // rename and change behaviour; the key stays
  await updateStatus(env, null, "suspended", { label: "On hold", tone: "info", grants_access: true })
  const hold = (await getStatusSet(env, null)).find((s) => s.key === "suspended")!
  assert.deepEqual([hold.label, hold.tone, hold.grants_access], ["On hold", "info", true])

  // the default can move to another status, and there is always exactly one
  await updateStatus(env, null, "pending", { is_default: true })
  let set = await getStatusSet(env, null)
  assert.deepEqual(set.filter((s) => s.is_default).map((s) => s.key), ["pending"])
  await updateStatus(env, null, "pending", { is_default: false })
  set = await getStatusSet(env, null)
  assert.equal(set.filter((s) => s.is_default).length, 1)

  // order
  await moveStatus(env, null, "expired", "up")
  assert.deepEqual((await getStatusSet(env, null)).map((s) => s.key).slice(4, 6), ["expired", "disabled"])
  const keys = (await getStatusSet(env, null)).map((s) => s.key).reverse()
  assert.ok("set" in (await setStatusOrder(env, null, keys)))
  assert.deepEqual((await getStatusSet(env, null)).map((s) => s.key), keys)
  assert.ok("error" in (await setStatusOrder(env, null, keys.slice(1))))
})

test("a status that is in use cannot be deleted without moving its licences", async () => {
  const { env, ctx } = setup()
  const a = await createLicense(env, { ...license, status: "suspended" })
  const b = await createLicense(env, { ...license, status: "suspended" })
  const c = await createLicense(env, license)
  const file = (await storeFile(env, { license: c }, { name: "n.html", statuses: "suspended,expired", size: 1, body: body("x") })) as { file: { id: string } }
  const app = (await createApp(env, { name: "App", slug: "app", description: "", default_duration_days: null, default_status: "suspended", default_max_sites: null, default_message: "", notes: "" })) as { app: { id: string } }

  assert.deepEqual(await statusUsage(env, null, "suspended"), { licenses: 2, files: 1 })
  assert.match((await deleteStatus(env, null, "suspended", null) as { error: string }).error, /2 licences/)
  assert.ok("error" in (await deleteStatus(env, null, "suspended", "suspended")))
  assert.ok("error" in (await deleteStatus(env, null, "suspended", "missing")))

  const deleted = await deleteStatus(env, null, "suspended", "disabled")
  assert.ok("set" in deleted)
  assert.equal((await getLicense(env, a.id))!.status, "disabled")
  assert.equal((await getLicense(env, b.id))!.status, "disabled")
  assert.equal((await getLicense(env, c.id))!.status, "active")
  assert.equal((await getFile(env, { license: c }, file.file.id))!.statuses, "expired,disabled") // the file rule follows the licences
  assert.equal((await env.DB.prepare("SELECT default_status FROM apps WHERE id = ?").bind(app.app.id).first<{ default_status: string }>())!.default_status, "disabled")
  assert.equal((await getStatusSet(env, null)).some((s) => s.key === "suspended"), false)
  void ctx
})

test("licences of apps without their own statuses count as using the default set", async () => {
  const { env } = setup()
  const { app } = (await createApp(env, { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })) as { app: { id: string } }
  await createLicense(env, { ...license, app_id: app.id, status: "suspended" })
  await createLicense(env, { ...license, status: "suspended" })
  assert.deepEqual(await statusCounts(env, null), { suspended: 2 })
  assert.equal((await statusUsage(env, null, "suspended")).licenses, 2)
  assert.ok("set" in (await deleteStatus(env, null, "suspended", "disabled")))
  assert.deepEqual(await statusCounts(env, null), { disabled: 2 }) // the licence under the app moved too

  // once the app has its own statuses, it no longer counts towards the default set
  await customizeAppStatuses(env, app.id)
  await createLicense(env, { ...license, app_id: app.id, status: "pending" })
  assert.deepEqual(await statusCounts(env, null), { disabled: 1 })
  assert.deepEqual(await statusCounts(env, app.id), { pending: 1, disabled: 1 })
})

test("deleting a status that other statuses expire into clears those rules", async () => {
  const { env } = setup()
  assert.ok("set" in (await deleteStatus(env, null, "expired", null)))
  assert.equal((await getStatusSet(env, null)).find((s) => s.key === "active")!.on_expiry, null)
  // the last statuses cannot all be removed, and the default cannot leave the set empty
  for (const key of ["pending", "completed", "disabled", "suspended"]) assert.ok("set" in (await deleteStatus(env, null, key, null)), key)
  assert.match(((await deleteStatus(env, null, "active", null)) as { error: string }).error, /at least one/i)
})

test("licences use their app's own statuses", async () => {
  const { env } = setup()
  const { app } = (await createApp(env, { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })) as { app: { id: string } }
  const other = (await createApp(env, { name: "Other", slug: "other", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "" })) as { app: { id: string } }

  assert.ok("set" in (await customizeAppStatuses(env, app.id)))
  assert.ok("error" in (await customizeAppStatuses(env, app.id)))
  await createStatus(env, app.id, { ...input, label: "Trial", on_expiry: "expired" })
  await createStatus(env, app.id, { ...input, label: "Refunded", grants_access: false, tone: "danger", check_message: "This licence was refunded." })

  const sets = await loadStatusSets(env)
  assert.equal(setFor(sets, app.id).some((s) => s.key === "trial"), true)
  assert.equal(setFor(sets, other.app.id).some((s) => s.key === "trial"), false) // another app keeps the default set
  assert.equal(setFor(sets, null).some((s) => s.key === "trial"), false)

  const trial = await createLicense(env, { ...license, app_id: app.id, status: "trial", expires_at: Date.now() + DAY })
  const refunded = await createLicense(env, { ...license, app_id: app.id, status: "refunded" })
  const standalone = await createLicense(env, license)

  const { ctx, settle } = makeCtx()
  const check = async (l: { license_key: string }) => {
    const res = await handleCheck(new Request(`https://w.dev/check/${l.license_key}`), env, ctx, l.license_key)
    await settle()
    return (await res.json()) as { valid: boolean; status: string; message: string }
  }
  assert.deepEqual([(await check(trial)).valid, (await check(trial)).status], [true, "trial"])
  const refundedResult = await check(refunded)
  assert.deepEqual([refundedResult.valid, refundedResult.status, refundedResult.message], [false, "refunded", "This licence was refunded."])
  assert.equal((await check(standalone)).valid, true)

  // filtering by effective status uses the right set for each licence
  await env.DB.prepare("UPDATE licenses SET expires_at = ? WHERE id = ?").bind(Date.now() - 1000, trial.id).run()
  assert.deepEqual((await queryLicenses(env, { status: "expired", limit: 10 })).map((l) => l.id), [trial.id])
  assert.deepEqual((await queryLicenses(env, { status: "refunded", limit: 10 })).map((l) => l.id), [refunded.id])
  assert.equal((await queryLicenses(env, { status: "trial", limit: 10 })).length, 0)
  assert.deepEqual((await queryLicenses(env, { status: "active", limit: 10 })).map((l) => l.id), [standalone.id])

  // renewing a licence that reached the status expiry points to returns it to the set's default
  assert.ok("set" in (await updateStatus(env, app.id, "trial", { is_default: true })))

  // going back to the default statuses needs licences on statuses the default set lacks to be moved
  const refusal = await resetAppStatuses(env, app.id)
  assert.ok("error" in refusal && /refunded|Trial/.test(refusal.error))
  await setStatus(env, (await getLicense(env, refunded.id))!, "trial")
  assert.deepEqual(await resetAppStatuses(env, app.id, { trial: "active", refunded: "disabled" }), { ok: true })
  assert.equal((await getLicense(env, trial.id))!.status, "active")
  assert.equal((await getLicense(env, refunded.id))!.status, "active")
  assert.equal(setFor(await loadStatusSets(env), app.id).some((s) => s.key === "trial"), false)
})

test("API: statuses", async () => {
  const { env } = setup()
  const manage = (await createApiKey(env, "m", "manage")).secret
  const full = (await createApiKey(env, "f", "full")).secret
  const read = (await createApiKey(env, "r", "read")).secret
  const { ctx } = makeCtx()
  const call = async (method: string, path: string, key: string, payload?: unknown) => {
    const res = await handleApi(new Request(`https://w.dev/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) }), env, ctx)
    return { status: res.status, json: (await res.json()) as any }
  }

  const list = await call("GET", "/statuses", read)
  assert.equal(list.json.data.length, 6)
  assert.deepEqual(Object.keys(list.json.data[0]).sort(), ["check_message", "description", "grants_access", "is_default", "key", "label", "on_expiry", "tone"])

  const created = await call("POST", "/statuses", manage, { label: "Grace period", grants_access: true, tone: "warning", on_expiry: "expired", check_message: "Renew soon" })
  assert.equal(created.status, 201)
  assert.deepEqual([created.json.key, created.json.grants_access, created.json.on_expiry], ["grace_period", true, "expired"])
  assert.equal((await call("POST", "/statuses", read, { label: "x" })).status, 403)
  assert.equal((await call("POST", "/statuses", manage, { label: "Grace period" })).status, 422) // duplicate
  assert.equal((await call("POST", "/statuses", manage, {})).status, 422)
  assert.equal((await call("POST", "/statuses", manage, { label: "Odd", tone: "purple" })).status, 422)

  const lic = (await call("POST", "/licenses", manage, { name: "A", status: "grace_period" })).json
  assert.deepEqual([lic.status, lic.valid], ["grace_period", true])
  assert.equal((await call("POST", "/licenses", manage, { name: "B", status: "nope" })).json.error.code, "invalid_status")
  assert.equal((await call("PATCH", "/statuses/grace_period", manage, { label: "Grace", grants_access: false })).json.grants_access, false)
  assert.equal((await call("GET", `/licenses/${lic.id}`, read)).json.valid, false)
  assert.equal((await call("PATCH", "/statuses/missing", manage, { label: "x" })).status, 404)

  assert.equal((await call("DELETE", "/statuses/grace_period", manage)).status, 403)
  assert.equal((await call("DELETE", "/statuses/grace_period", full)).json.error.code, "status_in_use")
  assert.equal((await call("DELETE", "/statuses/grace_period?move_to=active", full)).status, 200)
  assert.equal((await call("GET", `/licenses/${lic.id}`, read)).json.status, "active")

  const order = (await call("GET", "/statuses", read)).json.data.map((s: any) => s.key).reverse()
  assert.equal((await call("POST", "/statuses/order", manage, { keys: order })).json.data[0].key, order[0])
  assert.equal((await call("POST", "/statuses/order", manage, { keys: ["active"] })).status, 422)

  // app statuses: customise first, then edit, and licences of the app use them
  const app = (await call("POST", "/apps", manage, { name: "Harbor Theme" })).json
  assert.equal((await call("POST", "/apps/harbor-theme/statuses", manage, { label: "Trial" })).json.error.code, "statuses_not_customized")
  assert.equal((await call("GET", "/apps/harbor-theme/statuses", read)).json.custom, false)
  assert.equal((await call("POST", "/apps/harbor-theme/statuses/customize", manage)).status, 201)
  assert.equal((await call("POST", "/apps/harbor-theme/statuses/customize", manage)).status, 409)
  assert.equal((await call("POST", "/apps/harbor-theme/statuses", manage, { label: "Trial", grants_access: true, on_expiry: "expired" })).status, 201)
  const trial = await call("POST", "/apps/harbor-theme/licenses", manage, { name: "T", status: "trial", duration_days: 14 })
  assert.deepEqual([trial.status, trial.json.status, trial.json.valid], [201, "trial", true])
  assert.equal((await call("POST", "/licenses", manage, { name: "S", status: "trial" })).json.error.code, "invalid_status") // standalone licences use the default set
  assert.equal((await call("PATCH", "/apps/harbor-theme", manage, { default_status: "trial" })).json.default_status, "trial")
  assert.equal((await call("DELETE", "/apps/harbor-theme/statuses", full, { mapping: {} })).json.error.code, "statuses_in_use")
  assert.equal((await call("DELETE", "/apps/harbor-theme/statuses", full, { mapping: { trial: "active" } })).json.custom, false)
  assert.equal((await call("GET", `/licenses/${trial.json.id}`, read)).json.status, "active")
  void app
  assert.equal((await call("GET", "/stats", read)).json.by_status.active >= 2, true)
})
