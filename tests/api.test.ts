import { test } from "node:test"
import assert from "node:assert/strict"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import type { Scope } from "../app/lib/license.ts"
import { applyLicenseBody } from "../app/server/api-input.server.ts"
import { parseExpiry } from "../app/server/api-http.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { handleCheck } from "../app/server/check.server.ts"

const DAY = 86_400_000
const ORIGIN = "https://w.example"

async function setup() {
  const env = { DB: makeDb().DB, FILES: makeBucket().bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  const keys = {
    read: (await createApiKey(env, "r", "read")).secret,
    manage: (await createApiKey(env, "m", "manage")).secret,
    full: (await createApiKey(env, "f", "full")).secret,
  } satisfies Record<Scope, string>
  async function call(method: string, path: string, key: string | null, body?: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (key) headers.authorization = `Bearer ${key}`
    const res = await handleApi(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx)
    await settle()
    return { status: res.status, headers: res.headers, json: (await res.json()) as any }
  }
  return { env, keys, call, ctx }
}

test("authentication and scopes", async () => {
  const { keys, call } = await setup()
  assert.equal((await call("GET", "/licenses", null)).status, 401)
  assert.equal((await call("GET", "/licenses", "wk_" + "a".repeat(40))).status, 401)
  assert.equal((await call("GET", "/me", keys.read)).json.scope, "read")
  assert.equal((await call("POST", "/licenses", keys.read, { name: "x" })).status, 403)
  const made = await call("POST", "/licenses", keys.manage, { name: "x" })
  assert.equal(made.status, 201)
  assert.equal((await call("DELETE", `/licenses/${made.json.id}`, keys.manage)).status, 403)
  assert.equal((await call("POST", `/licenses/${made.json.id}/regenerate-key`, keys.manage)).status, 403)
  assert.equal((await call("DELETE", `/licenses/${made.json.id}`, keys.full)).json.deleted, true)
  assert.equal((await call("GET", "/openapi.json", null)).json.openapi, "3.1.0")
})

test("create, idempotent create, validation", async () => {
  const { keys, call } = await setup()
  const a = await call("POST", "/licenses", keys.manage, { name: "Harbor", customer_name: "H", domains: ["https://www.Harbor.com/x"], duration_days: 30, external_ref: "order-1" })
  assert.equal(a.status, 201)
  assert.match(a.json.key, /^WRD(-[A-Z0-9]{5}){4}$/)
  assert.equal(a.json.check_url, `${ORIGIN}/check/${a.json.key}`)
  assert.deepEqual(a.json.domains, ["harbor.com"])
  assert.equal(a.json.valid, true)
  assert.ok(Date.parse(a.json.expires_at) > Date.now() + 29 * DAY)

  const again = await call("POST", "/licenses", keys.manage, { name: "Other name", external_ref: "order-1" })
  assert.equal(again.status, 200)
  assert.equal(again.headers.get("idempotent-replayed"), "true")
  assert.equal(again.json.id, a.json.id)

  assert.equal((await call("POST", "/licenses", keys.manage, {})).status, 422)
  assert.equal((await call("POST", "/licenses", keys.manage, { name: "x", status: "expired" })).json.error.code, "invalid_status")
  assert.equal((await call("POST", "/licenses", keys.manage, { name: "x", expires_at: "tomorrow" })).json.error.code, "invalid_expires_at")
  assert.equal((await call("POST", "/licenses", keys.manage, { name: "x", domains: ["bad domain!"] })).json.error.code, "invalid_domains")
  assert.equal((await call("POST", "/licenses", keys.manage, { name: "x", external_ref: "" })).json.error.code, "invalid_external_ref")
})

test("read by id or key, patch, status, activity", async () => {
  const { keys, call } = await setup()
  const l = (await call("POST", "/licenses", keys.manage, { name: "A", notes: "n" })).json
  assert.equal((await call("GET", `/licenses/${l.key}`, keys.read)).json.id, l.id)
  assert.equal((await call("GET", "/licenses/lic_nope", keys.read)).status, 404)

  const p = await call("PATCH", `/licenses/${l.id}`, keys.manage, { message: "hello", expires_at: "2030-01-01" })
  assert.equal(p.json.message, "hello")
  assert.equal(p.json.notes, "n") // untouched fields stay
  assert.equal(p.json.expires_at, "2030-01-01T23:59:59.999Z")
  assert.equal((await call("PATCH", `/licenses/${l.id}`, keys.manage, { expires_at: null })).json.expires_at, null)

  assert.equal((await call("POST", `/licenses/${l.id}/status`, keys.manage, { status: "suspended" })).json.status, "suspended")
  assert.equal((await call("POST", `/licenses/${l.id}/status`, keys.manage, { status: "nope" })).status, 422)
  const log = (await call("GET", `/licenses/${l.id}/activity`, keys.read)).json.data.map((a: any) => a.detail).join("|")
  assert.match(log, /Status active -> suspended/)
})

test("renew by days and until, expired licences come back", async () => {
  const { keys, call } = await setup()
  const l = (await call("POST", "/licenses", keys.manage, { name: "A", expires_at: new Date(Date.now() - DAY).toISOString() })).json
  assert.equal(l.status, "expired")
  assert.equal(l.valid, false)
  const r = (await call("POST", `/licenses/${l.id}/renew`, keys.manage, { days: 30 })).json
  assert.equal(r.status, "active")
  assert.ok(Date.parse(r.expires_at) > Date.now() + 29 * DAY)

  const more = (await call("POST", `/licenses/${l.id}/renew`, keys.manage, { days: 30 })).json
  assert.ok(Date.parse(more.expires_at) > Date.parse(r.expires_at) + 29 * DAY) // counted from the current end date

  const until = (await call("POST", `/licenses/${l.id}/renew`, keys.manage, { until: "2031-06-30" })).json
  assert.equal(until.expires_at, "2031-06-30T23:59:59.999Z")
  assert.equal((await call("POST", `/licenses/${l.id}/renew`, keys.manage, { until: "2020-01-01" })).status, 422)
  assert.equal((await call("POST", `/licenses/${l.id}/renew`, keys.manage, {})).status, 422)

  await call("POST", `/licenses/${l.id}/status`, keys.manage, { status: "suspended" })
  assert.equal((await call("POST", `/licenses/${l.id}/renew`, keys.manage, { days: 5 })).json.status, "suspended") // renewing does not lift a suspension
})

test("regenerate key", async () => {
  const { keys, call } = await setup()
  const l = (await call("POST", "/licenses", keys.manage, { name: "A" })).json
  const n = (await call("POST", `/licenses/${l.id}/regenerate-key`, keys.full)).json
  assert.notEqual(n.key, l.key)
  assert.equal((await call("GET", `/licenses/${l.key}`, keys.read)).status, 404)
})

test("list: filters, search, pagination, stats", async () => {
  const { keys, call } = await setup()
  for (let i = 0; i < 5; i++) await call("POST", "/licenses", keys.manage, { name: `Site ${i}`, customer_name: i === 0 ? "Zed_100%" : "" })
  await call("POST", "/licenses", keys.manage, { name: "Old", expires_at: "2020-01-01" })
  await call("POST", "/licenses", keys.manage, { name: "Paused", status: "suspended" })

  assert.equal((await call("GET", "/licenses?status=expired", keys.read)).json.data.length, 1)
  assert.equal((await call("GET", "/licenses?status=active", keys.read)).json.data.length, 5)
  assert.equal((await call("GET", "/licenses?status=suspended", keys.read)).json.data[0].name, "Paused")
  assert.equal((await call("GET", "/licenses?status=bogus", keys.read)).status, 422)
  assert.equal((await call("GET", "/licenses?q=Zed_100%25", keys.read)).json.data.length, 1)
  assert.equal((await call("GET", "/licenses?q=Zed_999", keys.read)).json.data.length, 0)

  const page1 = (await call("GET", "/licenses?limit=3", keys.read)).json
  assert.equal(page1.data.length, 3)
  const page2 = (await call("GET", `/licenses?limit=3&before=${page1.next}`, keys.read)).json
  assert.equal(page2.data.length, 3)
  const page3 = (await call("GET", `/licenses?limit=3&before=${page2.next}`, keys.read)).json
  assert.equal(page3.data.length, 1)
  assert.equal(page3.next, null)
  assert.equal(new Set([...page1.data, ...page2.data, ...page3.data].map((l: any) => l.id)).size, 7)

  const stats = (await call("GET", "/stats", keys.read)).json
  assert.deepEqual([stats.total, stats.counts.active, stats.counts.expired, stats.counts.suspended], [7, 5, 1, 1])
})

test("helpers", () => {
  assert.equal(parseExpiry(null), null)
  assert.equal(parseExpiry("nope"), "invalid")
  assert.equal(parseExpiry(5), "invalid")
  const base = { name: "a", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active" as const, expires_at: null, domains: "", message: "", notes: "" }
  assert.ok("response" in applyLicenseBody({ name: 5 }, base))
  assert.ok("input" in applyLicenseBody({ message: "hi" }, base))
})

test("API: apps, defaults, listing and permissions", async () => {
  const { keys, call } = await setup()
  const created = await call("POST", "/apps", keys.manage, { name: "Harbor Theme", default_duration_days: 365, default_max_sites: 2, default_message: "Thanks for buying", default_status: "pending" })
  assert.equal(created.status, 201)
  assert.equal(created.json.slug, "harbor-theme")
  assert.deepEqual([created.json.default_max_sites, created.json.licenses, created.json.latest_version], [2, 0, null])
  assert.equal((await call("POST", "/apps", keys.read, { name: "x" })).status, 403)
  assert.equal((await call("POST", "/apps", keys.manage, { name: "Dup", slug: "harbor-theme" })).status, 409)
  assert.equal((await call("POST", "/apps", keys.manage, { name: "Bad", slug: "Bad Slug" })).json.error.code, "invalid_slug")
  assert.equal((await call("POST", "/apps", keys.manage, { default_status: "active" })).status, 422)
  assert.equal((await call("POST", "/apps", keys.manage, { name: "Zed", default_max_sites: 0 })).json.error.code, "invalid_default_max_sites")

  assert.equal((await call("GET", "/apps/harbor-theme", keys.read)).json.id, created.json.id)
  assert.equal((await call("GET", `/apps/${created.json.id}`, keys.read)).json.slug, "harbor-theme")
  assert.equal((await call("GET", "/apps/nope", keys.read)).status, 404)
  const patched = await call("PATCH", "/apps/harbor-theme", keys.manage, { description: "A theme", default_max_sites: null })
  assert.deepEqual([patched.json.description, patched.json.default_max_sites, patched.json.default_duration_days], ["A theme", null, 365])

  // a licence created under the app inherits its defaults; explicit values win
  const inherited = await call("POST", "/licenses", keys.manage, { name: "Customer A", app: "harbor-theme", customer_name: "Alice", customer_email: "alice@example.com" })
  assert.equal(inherited.status, 201)
  assert.deepEqual([inherited.json.status, inherited.json.message, inherited.json.max_sites, inherited.json.app.slug], ["pending", "Thanks for buying", null, "harbor-theme"])
  assert.ok(Math.abs(Date.parse(inherited.json.expires_at) - (Date.now() + 365 * DAY)) < 60_000)
  const explicit = await call("POST", "/apps/harbor-theme/licenses", keys.manage, { name: "Customer B", status: "active", max_sites: 5, expires_at: null, message: "Hi" })
  assert.deepEqual([explicit.json.status, explicit.json.max_sites, explicit.json.expires_at, explicit.json.message, explicit.json.app.id], ["active", 5, null, "Hi", created.json.id])
  assert.equal((await call("POST", "/licenses", keys.manage, { name: "X", app: "missing" })).json.error.code, "invalid_app")
  assert.equal((await call("POST", "/licenses", keys.manage, { name: "X", customer_email: "not-an-email" })).json.error.code, "invalid_customer_email")
  const standalone = await call("POST", "/licenses", keys.manage, { name: "Standalone" })
  assert.equal(standalone.json.app, null)

  // listing by app
  assert.equal((await call("GET", "/licenses?app=harbor-theme", keys.read)).json.data.length, 2)
  assert.equal((await call("GET", "/apps/harbor-theme/licenses", keys.read)).json.data.length, 2)
  assert.equal((await call("GET", "/licenses?app=nope", keys.read)).status, 422)
  assert.equal((await call("GET", "/licenses?q=alice%40example", keys.read)).json.data.length, 1)
  const summary = (await call("GET", "/apps", keys.read)).json.data[0]
  assert.deepEqual([summary.licenses, summary.licenses_in_force], [2, 1])

  // move a licence to another app, and out of any app
  const other = (await call("POST", "/apps", keys.manage, { name: "Other" })).json
  assert.equal((await call("PATCH", `/licenses/${standalone.json.id}`, keys.manage, { app: other.slug })).json.app.slug, "other")
  assert.equal((await call("PATCH", `/licenses/${standalone.json.id}`, keys.manage, { app: null })).json.app, null)
  assert.equal((await call("PATCH", `/licenses/${standalone.json.id}`, keys.manage, { max_sites: 3 })).json.max_sites, 3)

  // deleting an app needs full permission and an empty app
  assert.equal((await call("DELETE", "/apps/harbor-theme", keys.manage)).status, 403)
  assert.equal((await call("DELETE", "/apps/harbor-theme", keys.full)).json.error.code, "app_not_empty")
  assert.equal((await call("DELETE", "/apps/other", keys.full)).json.deleted, true)
})

test("API: app files and site activations", async () => {
  const { env, keys, call } = await setup()
  const app = (await call("POST", "/apps", keys.manage, { name: "Harbor Theme", default_max_sites: 1 })).json
  const lic = (await call("POST", "/apps/harbor-theme/licenses", keys.manage, { name: "A" })).json
  assert.equal(lic.max_sites, 1)

  // the call() helper sends JSON; uploads need a raw body with a content-length
  const put = async (path: string, key: string, payload: string) =>
    handleApi(new Request(`${ORIGIN}/api/v1${path}`, { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-length": String(new TextEncoder().encode(payload).length) }, body: payload }), env, makeCtx().ctx)
  const upload = await put("/apps/harbor-theme/files?name=theme-1.0.0.zip&version=1.0.0&statuses=active,completed", keys.manage, "zip")
  assert.equal(upload.status, 201)
  const file = (await upload.json()) as any
  assert.deepEqual([file.version, file.statuses, "download_url" in file, "available" in file], ["1.0.0", ["active", "completed"], false, false])
  assert.equal((await put("/apps/harbor-theme/files?name=x.zip", keys.read, "zz")).status, 403)
  assert.equal((await call("GET", "/apps/harbor-theme/files", keys.read)).json.data.length, 1)
  assert.equal((await call("GET", `/licenses/${lic.id}/files`, keys.read)).json.data.length, 0) // the licence's own files only
  assert.equal((await call("PATCH", `/apps/harbor-theme/files/${file.id}`, keys.manage, { statuses: ["completed"], version: "1.0.1" })).json.version, "1.0.1")
  assert.equal((await call("GET", "/apps/harbor-theme", keys.read)).json.latest_version, "1.0.1")
  assert.equal((await call("DELETE", `/apps/harbor-theme/files/${file.id}`, keys.manage)).json.deleted, true)
  assert.equal((await call("GET", "/apps/harbor-theme/files", keys.read)).json.data.length, 0)

  // site activations: registered by checks, released through the API
  const { ctx, settle } = makeCtx()
  const check = async (domain: string) => {
    const res = await handleCheck(new Request(`${ORIGIN}/check/${lic.key}?domain=${domain}`), env, ctx, lic.key)
    await settle()
    return ((await res.json()) as any).status as string
  }
  assert.equal(await check("a.com"), "active")
  assert.equal(await check("b.com"), "site_limit_reached")
  const sites = await call("GET", `/licenses/${lic.id}/activations`, keys.read)
  assert.deepEqual([sites.json.max_sites, sites.json.data.map((s: any) => s.domain)], [1, ["a.com"]])
  assert.equal((await call("GET", `/licenses/${lic.id}`, keys.read)).json.sites_used, 1)
  assert.equal((await call("DELETE", `/licenses/${lic.id}/activations/a.com`, keys.read)).status, 403)
  assert.equal((await call("DELETE", `/licenses/${lic.id}/activations/a.com`, keys.manage)).json.released, true)
  assert.equal((await call("DELETE", `/licenses/${lic.id}/activations/a.com`, keys.manage)).status, 404)
  assert.equal(await check("b.com"), "active")
})
