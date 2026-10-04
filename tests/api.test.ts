import { test } from "node:test"
import assert from "node:assert/strict"
import { makeCtx, makeDb } from "./helpers/d1.ts"
import type { Scope } from "../app/lib/license.ts"
import { applyBody, createApiKey, handleApi, parseEndDate } from "../app/server/api.server.ts"

const DAY = 86_400_000
const ORIGIN = "https://w.example"

async function setup() {
  const env = { DB: makeDb().DB } as unknown as Env
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
  return { env, keys, call }
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
  const a = await call("POST", "/licenses", keys.manage, { name: "Harbor", client: "H", domains: ["https://www.Harbor.com/x"], duration_days: 30, external_ref: "order-1" })
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
  for (let i = 0; i < 5; i++) await call("POST", "/licenses", keys.manage, { name: `Site ${i}`, client: i === 0 ? "Zed_100%" : "" })
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
  assert.equal(parseEndDate(null), null)
  assert.equal(parseEndDate("nope"), "invalid")
  assert.equal(parseEndDate(5), "invalid")
  const base = { name: "a", client: "", status: "active" as const, expires_at: null, domains: "", message: "", notes: "" }
  assert.ok("response" in applyBody({ name: 5 }, base))
  assert.ok("input" in applyBody({ message: "hi" }, base))
})
