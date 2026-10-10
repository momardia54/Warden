import { test } from "node:test"
import assert from "node:assert/strict"
import { makeCtx, makeDb } from "./helpers/d1.ts"
import { normalizeIp, parseIp, parseRange, formatRange, rangeContains } from "../app/lib/ip.ts"
import { trafficReport } from "../app/server/analytics.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { flushRefusals, guardPublic, resetGuard } from "../app/server/guard.server.ts"
import { blockedAmong, clearBlockCache, createBlock, deleteBlock, findBlock, listBlocks, pruneBlocks } from "../app/server/ip-blocks.server.ts"
import { clearProtectionCache } from "../app/server/protection.server.ts"
import { createLicense, listActivations, pruneActivity, recentActivity, type LicenseInput } from "../app/server/licenses.server.ts"

const base: LicenseInput = { name: "Licence", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }
const DAY = 86_400_000

function setup() {
  clearBlockCache()
  clearProtectionCache()
  resetGuard()
  return { DB: makeDb().DB } as unknown as Env
}
const from = (ip: string, path = "https://w.dev/check/WRD-AAAAA-BBBBB-CCCCC-DDDDD?domain=a.com") => new Request(path, { headers: { "cf-connecting-ip": ip } })

test("addresses and ranges are parsed and normalised", () => {
  assert.equal(normalizeIp(" 203.0.113.5 "), "203.0.113.5")
  assert.equal(normalizeIp("2001:DB8:0:0:0:0:0:1"), "2001:db8::1")
  assert.equal(normalizeIp("::ffff:203.0.113.5"), "203.0.113.5") // IPv4-mapped
  assert.equal(normalizeIp("2001:db8:0:1:0:0:0:0"), "2001:db8:0:1::")
  for (const bad of ["", "256.1.1.1", "1.2.3", "01.2.3.4", "1::2::3", "2001:db8::g", "example.com"]) assert.equal(normalizeIp(bad), null, bad)

  const range = (text: string) => {
    const r = parseRange(text)
    return "range" in r ? formatRange(r.range) : r.error
  }
  assert.equal(range("203.0.113.9/24"), "203.0.113.0/24") // the base is masked
  assert.equal(range("203.0.113.9/32"), "203.0.113.9")
  assert.equal(range("2001:db8::1/32"), "2001:db8::/32")
  assert.match(range("10.0.0.0/4"), /large part of the internet/)
  assert.match(range("2001::/8"), /large part of the internet/)
  assert.match(range("10.0.0.0/33"), /number from 8 to 32/)
  assert.match(range("nonsense"), /Enter an IP address/)

  const r = parseRange("203.0.113.0/24")
  assert.ok("range" in r)
  assert.equal(rangeContains(r.range, parseIp("203.0.113.200")!), true)
  assert.equal(rangeContains(r.range, parseIp("203.0.114.1")!), false)
  assert.equal(rangeContains(r.range, parseIp("2001:db8::1")!), false)
})

test("blocks: create, duplicate, renew after expiry, match, list, delete, prune", async () => {
  const env = setup()
  const now = Date.now()
  const created = await createBlock(env, { value: "203.0.113.0/24", reason: "  scraping keys  ", expires_at: null }, now)
  assert.ok("block" in created)
  assert.equal(created.block.reason, "scraping keys")
  assert.deepEqual(await createBlock(env, { value: "203.0.113.7/24", reason: "", expires_at: null }, now), { error: "203.0.113.0/24 is already blocked.", code: "exists" })
  assert.equal((await createBlock(env, { value: "198.51.100.1", reason: "", expires_at: now - 1 }, now) as { code: string }).code, "invalid")

  assert.equal((await findBlock(env, "203.0.113.77", now))?.id, created.block.id)
  assert.equal(await findBlock(env, "198.51.100.1", now), null)
  assert.equal(await findBlock(env, null, now), null)
  assert.deepEqual(await blockedAmong(env, ["203.0.113.1", "203.0.113.1", "8.8.8.8", null], now), ["203.0.113.1"])

  // A timed block stops applying when it ends, and the same address can be blocked again.
  const timed = await createBlock(env, { value: "198.51.100.1", reason: "", expires_at: now + DAY }, now)
  assert.ok("block" in timed)
  assert.ok(await findBlock(env, "198.51.100.1", now))
  assert.equal(await findBlock(env, "198.51.100.1", now + 2 * DAY), null)
  const renewed = await createBlock(env, { value: "198.51.100.1", reason: "again", expires_at: null }, now + 2 * DAY)
  assert.ok("block" in renewed && renewed.block.id === timed.block.id)
  assert.equal((await listBlocks(env)).length, 2)

  assert.equal(await deleteBlock(env, created.block.id), true)
  assert.equal(await deleteBlock(env, created.block.id), false)
  assert.equal(await findBlock(env, "203.0.113.77", now), null) // the cache is cleared on change

  await createBlock(env, { value: "192.0.2.1", reason: "", expires_at: now + DAY }, now)
  await pruneBlocks(env, now + 40 * DAY)
  assert.deepEqual((await listBlocks(env)).map((b) => b.value), ["198.51.100.1"])
})

test("the guard refuses blocked callers with 403, before any licence is read, and counts them", async () => {
  const env = setup()
  const { ctx, settle } = makeCtx()
  await createBlock(env, { value: "203.0.113.0/24", reason: "", expires_at: null })
  const blocked = await guardPublic(from("203.0.113.9"), env, ctx, "check", "WRD-AAAAA-BBBBB-CCCCC-DDDDD")
  assert.equal(blocked?.status, 403)
  assert.deepEqual(await blocked?.json(), { valid: false, status: "blocked", message: "Requests from this address are blocked." })
  const download = await guardPublic(from("203.0.113.9"), env, ctx, "download", "WRD-AAAAA-BBBBB-CCCCC-DDDDD")
  assert.equal(download?.status, 403)
  assert.equal(await guardPublic(from("198.51.100.1"), env, ctx, "check", "WRD-AAAAA-BBBBB-CCCCC-DDDDD"), null)
  assert.equal(await guardPublic(new Request("https://w.dev/check/X"), env, ctx, "check", "X"), null) // no address: let through

  await settle()
  await flushRefusals(env)
  assert.equal((await listBlocks(env))[0].hits, 2)
  assert.equal((await trafficReport(env, {}, 7)).totals.blocked, 2)
  assert.equal((await trafficReport(env, { standalone: true }, 7)).totals.blocked, null) // not attributable to a licence
})

test("rate limits answer 429 without a verdict, per IP and per key, and fail open", async () => {
  const env = setup()
  const { ctx } = makeCtx()
  const seen: string[] = []
  const limiter = (max: number) => {
    const counts = new Map<string, number>()
    return {
      limit: async ({ key }: { key: string }) => {
        seen.push(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        return { success: counts.get(key)! <= max }
      },
    }
  }
  // Defaults: checks per address 120 (RATE_LIMIT_120), per key 60, downloads per address 30.
  Object.assign(env, { RATE_LIMIT_120: limiter(2), RATE_LIMIT_60: limiter(100), RATE_LIMIT_30: { limit: async () => Promise.reject(new Error("down")) } })
  const key = "WRD-AAAAA-BBBBB-CCCCC-DDDDD"
  assert.equal(await guardPublic(from("198.51.100.1"), env, ctx, "check", key), null)
  assert.equal(await guardPublic(from("198.51.100.1"), env, ctx, "check", key), null)
  const limited = await guardPublic(from("198.51.100.1"), env, ctx, "check", key)
  assert.equal(limited?.status, 429)
  assert.equal(limited?.headers.get("retry-after"), "60")
  const body = (await limited?.json()) as Record<string, unknown>
  assert.equal(body.status, "rate_limited")
  assert.equal("valid" in body, false)
  assert.equal(await guardPublic(from("198.51.100.2"), env, ctx, "check", key), null) // another address has its own count
  assert.ok(seen.includes(`check:w.dev:198.51.100.1`) && seen.includes(`check-key:w.dev:${key}`))
  // A failing limiter lets the request through.
  assert.equal(await guardPublic(from("198.51.100.1"), env, ctx, "download", key), null)
})

test("checks and downloads record the caller's address; old addresses are cleared", async () => {
  const env = setup()
  const { ctx, settle } = makeCtx()
  const lic = await createLicense(env, { ...base, name: "Harbor" })
  await handleCheck(new Request(`https://w.dev/check/${lic.license_key}?domain=harbor.com`, { headers: { "cf-connecting-ip": "2001:DB8::5" } }), env, ctx, lic.license_key)
  await settle()
  const [check] = await recentActivity(env, lic.id, 1)
  assert.equal(check.ip, "2001:db8::5")
  assert.equal((await listActivations(env, lic.id))[0].last_ip, "2001:db8::5")

  const report = await trafficReport(env, {}, 7)
  assert.deepEqual(report.ips.map((r) => ({ ...r })), [{ ip: "2001:db8::5", checks: 1, refused: 0, downloads: 0, licenses: 1, blocked: false }])

  const old = Date.now() - 100 * DAY
  await env.DB.prepare("INSERT INTO activity (license_id, at, event, status, domain, detail, ip) VALUES (?, ?, 'download', 'active', NULL, 'Downloaded: a.zip', '203.0.113.1')").bind(lic.id, old).run()
  await pruneActivity(env)
  const kept = await env.DB.prepare("SELECT ip FROM activity WHERE event = 'download'").first<{ ip: string | null }>()
  assert.equal(kept?.ip, null) // the download stays, without the address
})
