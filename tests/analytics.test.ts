import { test } from "node:test"
import assert from "node:assert/strict"
import { makeCtx, makeDb } from "./helpers/d1.ts"
import { DAY_MS, emptySeries, periodStart, readRange } from "../app/lib/analytics.ts"
import { dailyTraffic, trafficReport } from "../app/server/analytics.server.ts"
import { createApp } from "../app/server/apps.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { createLicense, type LicenseInput } from "../app/server/licenses.server.ts"
import { saveStatusSet } from "../app/server/statuses.server.ts"
import { DEFAULT_STATUSES } from "../app/lib/statuses.ts"

const base: LicenseInput = { name: "Licence", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }
const appInput = { name: "Harbor Theme", slug: "harbor-theme", description: "", default_duration_days: 365, default_status: "active" as const, default_max_sites: null, default_message: "", notes: "" }

test("periods cover whole UTC days ending today", () => {
  const now = Date.parse("2026-10-10T15:00:00Z")
  assert.equal(new Date(periodStart(7, now)).toISOString(), "2026-10-04T00:00:00.000Z")
  const series = emptySeries(7, now)
  assert.equal(series.length, 7)
  assert.equal(series[0].date, "2026-10-04")
  assert.equal(series[6].date, "2026-10-10")
  assert.equal(readRange("90"), 90)
  assert.equal(readRange("365"), 30) // only the offered periods
  assert.equal(readRange(null), 30)
})

test("checks are split into valid and invalid per day, by each licence's statuses", async () => {
  const env = { DB: makeDb().DB } as unknown as Env
  const { ctx, settle } = makeCtx()
  const check = (key: string, domain: string) => handleCheck(new Request(`https://w.dev/check/${key}?domain=${domain}`), env, ctx, key)

  const created = await createApp(env, appInput)
  assert.ok("app" in created)
  const app = created.app
  const shop = await createLicense(env, { ...base, name: "Shop", app_id: app.id, max_sites: 1 })
  const suspended = await createLicense(env, { ...base, name: "Suspended", status: "suspended" })
  // A standalone licence whose own "trial" status lets sites run.
  const trial = await createLicense(env, { ...base, name: "Trial" })
  const own = [...DEFAULT_STATUSES.map((s) => ({ ...s })), { ...DEFAULT_STATUSES[1], key: "trial", label: "Trial", is_default: false, on_expiry: null, position: 99 }]
  assert.deepEqual(await saveStatusSet(env, { license: trial.id }, own), { ok: true })
  await env.DB.prepare("UPDATE licenses SET status = 'trial' WHERE id = ?").bind(trial.id).run()

  await check(shop.license_key, "shop.example")
  await check(shop.license_key, "shop.example")
  await check(shop.license_key, "other.example") // site limit reached
  await check(suspended.license_key, "suspended.example")
  await check(trial.license_key, "trial.example")
  await settle()
  // An old check, two days ago, and one outside the period.
  const now = Date.now()
  await env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'check', 'active', 'shop.example', '')").bind(shop.id, now - 2 * DAY_MS).run()
  await env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'check', 'active', 'shop.example', '')").bind(shop.id, now - 40 * DAY_MS).run()
  await env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'download', 'active', 'shop.example', 'Downloaded: harbor-1.0.0.zip')").bind(shop.id, now).run()
  await env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail) VALUES (?, ?, 'download', 'suspended', NULL, 'Download refused: harbor-1.0.0.zip (available when Active)')").bind(suspended.id, now).run()

  const report = await trafficReport(env, {}, 30, now)
  assert.equal(report.series.length, 30)
  const today = report.series[29]
  assert.deepEqual({ valid: today.valid, invalid: today.invalid, sites: today.sites, downloads: today.downloads }, { valid: 3, invalid: 2, sites: 3, downloads: 1 })
  assert.equal(report.series[27].valid, 1)
  assert.deepEqual(report.totals, { checks: 6, valid: 4, invalid: 2, sites: 3, new_sites: 3, downloads: 1, denied_downloads: 1, blocked: 0, rate_limited: 0 })
  assert.deepEqual(
    report.reasons.map((r) => [r.key, r.label, r.checks]).sort(),
    [["site_limit_reached", "Site limit reached", 1], ["suspended", "Suspended", 1]]
  )
  assert.deepEqual(report.licenses[0], { id: shop.id, name: "Shop", app_name: "Harbor Theme", checks: 4, invalid: 1, last_check_at: report.licenses[0].last_check_at })
  assert.deepEqual(report.files.map((f) => ({ ...f })), [{ name: "harbor-1.0.0.zip", downloads: 1 }])

  // Scopes.
  const appOnly = await trafficReport(env, { app: app.id }, 7, now)
  assert.deepEqual([appOnly.totals.checks, appOnly.totals.invalid], [4, 1])
  const standalone = await trafficReport(env, { standalone: true }, 7, now)
  assert.deepEqual([standalone.totals.checks, standalone.totals.valid], [2, 1])
  const one = await dailyTraffic(env, { license: trial.id }, 7, now)
  assert.equal(one.series.reduce((n, d) => n + d.valid + d.invalid, 0), 1)
  assert.equal((await trafficReport(env, {}, 90, now)).totals.checks, 7)
})
