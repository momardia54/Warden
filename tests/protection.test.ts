import { test } from "node:test"
import assert from "node:assert/strict"
import { makeCtx, makeDb } from "./helpers/d1.ts"
import { DEFAULT_PROTECTION, readProtection } from "../app/lib/protection.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { guardPublic, resetGuard } from "../app/server/guard.server.ts"
import { clearBlockCache, findBlock, listBlocks } from "../app/server/ip-blocks.server.ts"
import { applyRules, clearProtectionCache, getProtection, pruneIpEvents, saveProtection } from "../app/server/protection.server.ts"
import { createLicense, type LicenseInput } from "../app/server/licenses.server.ts"

const base: LicenseInput = { name: "Licence", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }

function setup() {
  clearBlockCache()
  clearProtectionCache()
  resetGuard()
  return { DB: makeDb().DB } as unknown as Env
}
const check = (env: Env, ctx: ExecutionContext, key: string, ip: string, domain = "a.com") =>
  handleCheck(new Request(`https://w.dev/check/${key}?domain=${domain}`, { headers: { "cf-connecting-ip": ip } }), env, ctx, key)

test("settings are validated, merged with what is stored, and cached", async () => {
  assert.match((readProtection({ limits: { check_ip: 99 } }) as { error: string }).error, /0 \(off\) or one of 30, 60/)
  assert.match((readProtection({ limits: { nope: 30 } }) as { error: string }).error, /Unknown limit/)
  assert.match((readProtection({ rules: { invalid_keys: { count: 1 } } }) as { error: string }).error, /from 2 to/)
  assert.match((readProtection({ rules: { invalid_keys: { minutes: 7 } } }) as { error: string }).error, /minutes must be one of/)
  assert.match((readProtection({ rules: { invalid_keys: { block_hours: 2 } } }) as { error: string }).error, /block_hours/)
  assert.match((readProtection({ never_block: ["0.0.0.0/0"] }) as { error: string }).error, /are not accepted/)

  const env = setup()
  assert.deepEqual(await getProtection(env), DEFAULT_PROTECTION)
  const saved = await saveProtection(env, { limits: { check_ip: 300 }, never_block: ["198.51.100.9/32", "", "198.51.100.9"] })
  assert.ok("settings" in saved)
  assert.equal(saved.settings.limits.check_ip, 300)
  assert.equal(saved.settings.limits.api_key, 600) // untouched
  assert.deepEqual(saved.settings.never_block, ["198.51.100.9"])
  await saveProtection(env, { rules: { invalid_checks: { enabled: true } } })
  clearProtectionCache()
  const stored = await getProtection(env)
  assert.equal(stored.limits.check_ip, 300) // the first save survives the second
  assert.equal(stored.rules.invalid_checks.enabled, true)
})

test("guessing licence keys blocks the address automatically", async () => {
  const env = setup()
  const { ctx, settle } = makeCtx()
  await saveProtection(env, { rules: { invalid_keys: { count: 3, minutes: 10, block_hours: 6 } } })
  for (let i = 0; i < 3; i++) await check(env, ctx, `WRD-AAAAA-AAAAA-AAAAA-AAAA${i}`, "203.0.113.50")
  await settle()
  const block = await findBlock(env, "203.0.113.50")
  assert.ok(block)
  assert.equal(block.source, "auto")
  assert.equal(block.reason, 'Rule "Invalid licence keys": 3 requests with an invalid licence key in 10 minutes.')
  assert.ok(block.expires_at && Math.abs(block.expires_at - Date.now() - 6 * 3_600_000) < 60_000)
  // The next request is refused before any licence is read.
  assert.equal((await guardPublic(new Request("https://w.dev/check/X", { headers: { "cf-connecting-ip": "203.0.113.50" } }), env, ctx, "check", "X"))?.status, 403)
})

test("rules that are off write nothing; trusted addresses are never blocked or limited", async () => {
  const env = setup()
  const { ctx, settle } = makeCtx()
  await saveProtection(env, { rules: { invalid_keys: { enabled: false } } })
  for (let i = 0; i < 25; i++) await check(env, ctx, `WRD-AAAAA-AAAAA-AAAAA-AAA${String(i).padStart(2, "0")}`, "203.0.113.51")
  await settle()
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM ip_events").first<{ n: number }>())?.n, 0)
  assert.equal(await findBlock(env, "203.0.113.51"), null)

  await saveProtection(env, { rules: { invalid_keys: { enabled: true, count: 2 } }, never_block: ["198.51.100.0/24"] })
  for (let i = 0; i < 5; i++) await check(env, ctx, `WRD-AAAAA-AAAAA-AAAAA-AAAB${i}`, "198.51.100.7")
  await settle()
  assert.equal(await findBlock(env, "198.51.100.7"), null)
  Object.assign(env, { RATE_LIMIT_120: { limit: async () => ({ success: false }) } })
  assert.equal(await guardPublic(new Request("https://w.dev/check/X", { headers: { "cf-connecting-ip": "198.51.100.7" } }), env, ctx, "check", "X"), null)
})

test("refused checks and many licences, judged by each licence's statuses", async () => {
  const env = setup()
  const { ctx, settle } = makeCtx()
  await saveProtection(env, { rules: { invalid_checks: { enabled: true, count: 3 }, licenses_per_ip: { enabled: true, count: 3 } } })
  const suspended = await createLicense(env, { ...base, status: "suspended" })
  const active = await createLicense(env, { ...base })
  // Valid checks do not count as refused.
  for (let i = 0; i < 4; i++) await check(env, ctx, active.license_key, "192.0.2.10")
  await settle()
  assert.equal(await findBlock(env, "192.0.2.10"), null)
  for (let i = 0; i < 3; i++) await check(env, ctx, suspended.license_key, "192.0.2.11")
  await settle()
  assert.match((await findBlock(env, "192.0.2.11"))?.reason ?? "", /3 invalid checks/)

  const keys = []
  for (const i of [1, 2, 3]) keys.push(await createLicense(env, { ...base, name: `L${i}` }))
  for (const lic of keys) await check(env, ctx, lic.license_key, "192.0.2.12", `site${lic.name}.com`)
  await settle()
  assert.match((await findBlock(env, "192.0.2.12"))?.reason ?? "", /3 distinct licences checked/)
})

test("staying over a rate limit blocks the address, counted once a minute", async () => {
  const env = setup()
  const { ctx, settle } = makeCtx()
  Object.assign(env, { RATE_LIMIT_120: { limit: async () => ({ success: false }) } })
  await saveProtection(env, { rules: { rate_limit_violations: { count: 2 } } })
  const now = Date.now()
  const req = () => new Request("https://w.dev/check/X", { headers: { "cf-connecting-ip": "192.0.2.20" } })
  assert.equal((await guardPublic(req(), env, ctx, "check", "X", now))?.status, 429)
  assert.equal((await guardPublic(req(), env, ctx, "check", "X", now + 1000))?.status, 429) // same minute: no new strike
  await settle()
  assert.equal(await findBlock(env, "192.0.2.20"), null)
  await guardPublic(req(), env, ctx, "check", "X", now + 61_000)
  await settle()
  assert.equal((await listBlocks(env))[0]?.value, "192.0.2.20")

  await pruneIpEvents(env, now + 2 * 86_400_000)
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM ip_events").first<{ n: number }>())?.n, 0)
})

test("a rule does not block an address twice", async () => {
  const env = setup()
  await saveProtection(env, { rules: { invalid_keys: { count: 2 } } })
  for (let i = 0; i < 4; i++) await applyRules(env, "192.0.2.30", { kind: "invalid_key" })
  assert.equal((await listBlocks(env)).length, 1)
})

test("stored settings with keys this version does not know keep the rest", async () => {
  const env = setup()
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('protection', ?, 0)")
    .bind(JSON.stringify({ limits: { check_ip: 300, retired_limit: 5 }, rules: { retired_rule: { enabled: true }, invalid_checks: { enabled: true } }, never_block: ["198.51.100.1"] }))
    .run()
  const settings = await getProtection(env)
  assert.equal(settings.limits.check_ip, 300)
  assert.equal(settings.rules.invalid_checks.enabled, true)
  assert.deepEqual(settings.never_block, ["198.51.100.1"])
})
