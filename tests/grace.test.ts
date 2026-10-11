import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { buildCheckResponse } from "../app/lib/license.ts"
import { DEFAULT_STATUSES, effectiveStatusKey, graceDays, graceEndsAt } from "../app/lib/statuses.ts"
import { inView } from "../app/lib/views.ts"
import { createApp } from "../app/server/apps.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { createLicense, extendLicense, getLicense, type LicenseInput } from "../app/server/licenses.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"

const DAY = 86_400_000
const NOW = Date.parse("2026-10-11T12:00:00Z")
const ORIGIN = "https://w.dev"
const base: LicenseInput = { name: "Harbor", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }

test("the grace period delays the expiry rule, and the licence's own setting overrides its app's", () => {
  const expired = { status: "active", expires_at: NOW - 2 * DAY }
  assert.equal(effectiveStatusKey(expired, DEFAULT_STATUSES, NOW), "expired")
  assert.equal(effectiveStatusKey({ ...expired, app_grace_days: 7 }, DEFAULT_STATUSES, NOW), "active")
  assert.equal(effectiveStatusKey({ ...expired, app_grace_days: 7, grace_days: 1 }, DEFAULT_STATUSES, NOW), "expired") // own setting wins
  assert.equal(effectiveStatusKey({ ...expired, app_grace_days: 7, grace_days: 0 }, DEFAULT_STATUSES, NOW), "expired") // 0: none
  assert.equal(graceDays({ ...expired, grace_days: null, app_grace_days: 5 }), 5)

  assert.equal(graceEndsAt({ ...expired, grace_days: 7 }, DEFAULT_STATUSES, NOW), NOW + 5 * DAY)
  assert.equal(graceEndsAt({ status: "active", expires_at: NOW + DAY, grace_days: 7 }, DEFAULT_STATUSES, NOW), null) // not expired yet
  assert.equal(graceEndsAt({ ...expired, grace_days: 1 }, DEFAULT_STATUSES, NOW), null) // grace over
  assert.equal(graceEndsAt({ status: "completed", expires_at: NOW - DAY, grace_days: 7 }, DEFAULT_STATUSES, NOW), null) // no expiry rule

  // A licence in its grace period is valid, and shows in the "expiring" view so it gets attention.
  const facts = { ...expired, grace_days: 7, last_check_at: NOW, created_at: NOW - 30 * DAY }
  assert.equal(inView(facts, DEFAULT_STATUSES, "valid", NOW), true)
  assert.equal(inView(facts, DEFAULT_STATUSES, "expiring", NOW), true)
})

test("the check response reports the grace period with a reminder, unless the licence has a message of its own", () => {
  const license = { name: "Harbor", status: "active", expires_at: Date.parse("2026-10-09T23:59:59.999Z"), domains: "", message: "", grace_days: 7 }
  const r = buildCheckResponse(license, null, NOW, [], DEFAULT_STATUSES)
  assert.deepEqual([r.valid, r.status, r.grace_ends_at], [true, "active", "2026-10-16T23:59:59.999Z"])
  assert.equal(r.message, "This licence expired on 2026-10-09. It remains valid until 2026-10-16; renew it to keep using it.")
  assert.equal(buildCheckResponse({ ...license, message: "Thanks!" }, null, NOW, [], DEFAULT_STATUSES).message, "Thanks!")
  const after = buildCheckResponse(license, null, NOW + 10 * DAY, [], DEFAULT_STATUSES)
  assert.deepEqual([after.valid, after.status, after.grace_ends_at], [false, "expired", null])
  assert.equal(buildCheckResponse({ ...license, expires_at: NOW + DAY }, null, NOW, [], DEFAULT_STATUSES).grace_ends_at, null)
})

test("grace period end to end: app setting, licence override, check, renewal and API", async () => {
  const env = { DB: makeDb().DB, FILES: makeBucket().bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  const app = await createApp(env, { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: null, default_status: "active", default_max_sites: null, default_message: "", notes: "", grace_days: 14 })
  assert.ok("app" in app)
  const now = Date.now()
  const inApp = await createLicense(env, { ...base, app_id: app.app.id, expires_at: now - 3 * DAY })
  const own = await createLicense(env, { ...base, app_id: app.app.id, expires_at: now - 3 * DAY, grace_days: 0 })

  const check = async (key: string) => {
    const res = (await (await handleCheck(new Request(`${ORIGIN}/check/${key}`), env, ctx, key)).json()) as any
    await settle()
    return res
  }
  const graced = await check(inApp.license_key)
  assert.deepEqual([graced.valid, graced.status], [true, "active"])
  assert.ok(Date.parse(graced.grace_ends_at) > now + 10 * DAY)
  assert.deepEqual([(await check(own.license_key)).valid, (await check(own.license_key)).status], [false, "expired"])

  // Renewing during the grace period counts from the expiry date: the grace days used are not given again.
  await extendLicense(env, inApp, 30)
  assert.equal((await getLicense(env, inApp.id))!.expires_at, inApp.expires_at! + 30 * DAY)

  const key = (await createApiKey(env, "m", "full")).secret
  const api = async (method: string, path: string, body?: unknown) =>
    (await (await handleApi(new Request(`${ORIGIN}/api/v1${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx)).json()) as any
  const viaApi = await api("GET", `/licenses/${own.id}`)
  assert.deepEqual([viaApi.grace_days, viaApi.effective_grace_days, viaApi.grace_ends_at], [0, 0, null])
  const reset = await api("PATCH", `/licenses/${own.id}`, { grace_days: null })
  assert.deepEqual([reset.grace_days, reset.effective_grace_days, reset.valid], [null, 14, true])
  assert.equal((await api("PATCH", `/licenses/${own.id}`, { grace_days: 400 })).error.code, "invalid_grace_days")
  assert.equal((await api("PATCH", "/apps/harbor-theme", { grace_days: 0 })).error.code, "invalid_grace_days") // apps: null for none
  assert.equal((await api("PATCH", "/apps/harbor-theme", { grace_days: null })).grace_days, null)
  assert.equal((await api("GET", `/licenses/${own.id}`)).valid, false)
})
