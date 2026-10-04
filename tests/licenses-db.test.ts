import { test } from "node:test"
import assert from "node:assert/strict"
import { makeCtx, makeDb } from "./helpers/d1.ts"
import { createLicense, extendLicense, getLicense, overviewStats, readLicenseForm, recentActivity, regenerateKey, setStatus, deleteLicense, pruneActivity, updateLicense } from "../app/server/licenses.server.ts"
import { handleCheck } from "../app/server/check.server.ts"
import { hmacHex } from "../app/server/util.server.ts"

const input = { name: "OCWOF", client: "", status: "active" as const, expires_at: null, domains: "", message: "", notes: "" }
const envOf = () => ({ DB: makeDb().DB }) as unknown as Env

function form(entries: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

test("form validation", () => {
  assert.ok("error" in readLicenseForm(form({ name: " " })))
  assert.ok("error" in readLicenseForm(form({ name: "x", expires_at: "10/10/2026" })))
  assert.ok("error" in readLicenseForm(form({ name: "x", domains: "bad domain!" })))
  const ok = readLicenseForm(form({ name: "x", expires_at: "2026-12-31", domains: "https://www.a.org, b.org" }))
  assert.ok("input" in ok)
  if ("input" in ok) {
    assert.equal(ok.input.domains, "a.org, b.org")
    assert.equal(ok.input.expires_at, Date.parse("2026-12-31T23:59:59.999Z"))
  }
})

test("create, change status, extend, regenerate, delete", async () => {
  const env = envOf()
  const lic = await createLicense(env, input)
  await setStatus(env, lic, "suspended")
  assert.equal((await getLicense(env, lic.id))!.status, "suspended")

  const ended = await createLicense(env, { ...input, expires_at: Date.now() - 1000 })
  await extendLicense(env, { ...ended, status: "expired" }, 30)
  const extended = (await getLicense(env, ended.id))!
  assert.equal(extended.status, "active")
  assert.ok(extended.expires_at! > Date.now() + 29 * 86_400_000)

  await regenerateKey(env, lic)
  const after = (await getLicense(env, lic.id))!
  assert.notEqual(after.license_key, lic.license_key)

  await updateLicense(env, after, { ...input, name: "Renamed" })
  const log = (await recentActivity(env, lic.id)).map((a) => a.detail).join("|")
  assert.match(log, /Status active -> suspended/)
  assert.match(log, /Key regenerated/)
  assert.match(log, /Details edited/)

  await deleteLicense(env, lic.id)
  assert.equal(await getLicense(env, lic.id), null)
})

test("check endpoint: answers, signature, logging, unknown keys", async () => {
  const env = envOf()
  const { ctx, settle } = makeCtx()
  const lic = await createLicense(env, { ...input, domains: "ocwof.org" })

  const ok = await handleCheck(new Request(`https://w.dev/check/${lic.license_key}?domain=www.ocwof.org`), env, ctx, lic.license_key)
  const text = await ok.text()
  assert.equal(ok.status, 200)
  assert.equal(JSON.parse(text).valid, true)
  assert.equal(ok.headers.get("x-warden-signature"), await hmacHex(lic.license_key, text))

  const wrong = await handleCheck(new Request(`https://w.dev/check/${lic.license_key}?domain=evil.com`), env, ctx, lic.license_key)
  assert.equal((await wrong.json() as { status: string }).status, "domain_mismatch")

  await setStatus(env, lic, "disabled")
  const off = await handleCheck(new Request(`https://w.dev/check/${lic.license_key}?domain=ocwof.org`, { method: "POST", body: "{}" }), env, ctx, lic.license_key)
  assert.equal((await off.json() as { valid: boolean }).valid, false)

  const unknown = await handleCheck(new Request("https://w.dev/check/WRD-AAAAA-AAAAA-AAAAA-AAAAA"), env, ctx, "WRD-AAAAA-AAAAA-AAAAA-AAAAA")
  assert.equal(unknown.status, 404)
  assert.equal(unknown.headers.get("x-warden-signature"), null)

  await settle()
  const row = (await getLicense(env, lic.id))!
  assert.equal(row.check_count, 3)
  assert.equal(row.last_check_domain, "ocwof.org")
})

test("overview counts and pruning", async () => {
  const env = envOf()
  const now = Date.now()
  await createLicense(env, input)
  await createLicense(env, { ...input, expires_at: now + 5 * 86_400_000 })
  await createLicense(env, { ...input, expires_at: now - 1000 })
  await createLicense(env, { ...input, status: "suspended" })
  const stats = await overviewStats(env, now)
  assert.deepEqual([stats.total, stats.counts.active, stats.counts.expired, stats.counts.suspended, stats.endingSoon], [4, 2, 1, 1, 1])
  assert.equal((await overviewStats(env, now + 4 * 86_400_000)).silent, 2)

  const lic = await createLicense(env, input)
  await env.DB.prepare("INSERT INTO activity (license_id, at, kind, status, detail) VALUES (?, ?, 'check', 'active', '')").bind(lic.id, now - 100 * 86_400_000).run()
  await pruneActivity(env, now)
  const left = await env.DB.prepare("SELECT COUNT(*) AS c FROM activity WHERE kind = 'check'").first<{ c: number }>()
  assert.equal(left!.c, 0)
})
