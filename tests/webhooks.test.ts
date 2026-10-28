import { test } from "node:test"
import assert from "node:assert/strict"
import { createPublicKey, verify } from "node:crypto"
import { makeBucket, makeCtx, makeDb, mockFetch } from "./helpers/d1.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { createLicense, getLicense, scanLicenseEvents, type LicenseInput } from "../app/server/licenses.server.ts"
import { deliverDue, flushAfterResponse, rememberOrigin, resetOriginCache } from "../app/server/webhooks.server.ts"
import { getSigningKey, resetSigningKeyCache } from "../app/server/signing.server.ts"
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, validateWebhookUrl } from "../app/lib/webhooks.ts"

const DAY = 86_400_000
const ORIGIN = "https://w.dev"
const base: LicenseInput = { name: "Copper Salon", customer_name: "", customer_email: "", app_id: null, max_sites: null, status: "active", expires_at: null, domains: "", message: "", notes: "" }

async function setup() {
  resetSigningKeyCache()
  resetOriginCache()
  const env = { DB: makeDb().DB, FILES: makeBucket().bucket } as unknown as Env
  const { ctx, settle } = makeCtx()
  rememberOrigin(env, ctx, ORIGIN)
  await settle()
  const key = (await createApiKey(env, "f", "full")).secret
  const readKey = (await createApiKey(env, "r", "manage")).secret
  async function api(method: string, path: string, body?: unknown, as = key) {
    const res = await handleApi(new Request(`${ORIGIN}/api/v1${path}`, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx)
    flushAfterResponse(env, ctx)
    await settle()
    return { status: res.status, json: (await res.json()) as any }
  }
  const deliveries = async () => (await env.DB.prepare("SELECT * FROM webhook_deliveries ORDER BY created_at, id").all<any>()).results
  return { env, ctx, settle, api, readKey, deliveries }
}

test("endpoint addresses: HTTPS, or HTTP on localhost only", () => {
  assert.deepEqual(validateWebhookUrl("https://hooks.harborstudio.com/warden"), { url: "https://hooks.harborstudio.com/warden" })
  assert.ok("url" in validateWebhookUrl("http://localhost:8787/hook"))
  assert.ok("error" in validateWebhookUrl("http://hooks.harborstudio.com/warden"))
  assert.ok("error" in validateWebhookUrl("https://user:pass@hooks.harborstudio.com"))
  assert.ok("error" in validateWebhookUrl("not a url"))
})

test("webhooks API: validation, permissions and the limit", async () => {
  const { api, readKey } = await setup()
  assert.equal((await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.created"] }, readKey)).status, 403)
  assert.equal((await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: [] })).json.error.code, "invalid_events")
  assert.equal((await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.nope"] })).json.error.code, "invalid_events")
  assert.equal((await api("POST", "/webhooks", { url: "ftp://hooks.example.com/w", events: ["license.created"] })).json.error.code, "invalid_url")
  const made = await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.expired", "license.created"], description: "Billing" })
  assert.equal(made.status, 201)
  // Events are kept in the catalogue's order.
  assert.deepEqual([made.json.events, made.json.enabled, made.json.description], [["license.created", "license.expired"], true, "Billing"])
  const patched = await api("PATCH", `/webhooks/${made.json.id}`, { enabled: false })
  assert.deepEqual([patched.json.enabled, patched.json.url], [false, "https://hooks.example.com/w"])
  for (let i = 1; i < 10; i++) assert.equal((await api("POST", "/webhooks", { url: `https://hooks.example.com/${i}`, events: ["license.created"] })).status, 201)
  assert.equal((await api("POST", "/webhooks", { url: "https://hooks.example.com/11", events: ["license.created"] })).json.error.code, "too_many_webhooks")
  assert.equal((await api("GET", "/webhooks")).json.data.length, 10)
  assert.equal((await api("DELETE", `/webhooks/${made.json.id}`)).json.deleted, true)
  assert.equal((await api("GET", `/webhooks/${made.json.id}`)).json.error.code, "webhook_not_found")
})

test("licence changes are delivered to subscribed endpoints, signed, right after the request", async () => {
  const { env, api, deliveries } = await setup()
  const fetches = mockFetch()
  try {
    const hook = (await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.created", "license.status_changed", "license.renewed", "license.deleted"] })).json
    await api("POST", "/webhooks", { url: "https://hooks.example.com/off", events: ["license.created"], enabled: false })
    await api("POST", "/webhooks", { url: "https://hooks.example.com/other", events: ["license.expired"] })

    const license = (await api("POST", "/licenses", { name: "Copper Salon", duration_days: 30 })).json
    assert.equal(fetches.sent.length, 1) // only the enabled endpoint subscribed to license.created
    const sent = fetches.sent[0]
    assert.equal(sent.url, "https://hooks.example.com/w")
    assert.equal(sent.headers.get("x-warden-event"), "license.created")
    const key = await getSigningKey(env)
    assert.ok(verify(null, Buffer.from(sent.body), createPublicKey(key.publicKeyPem), Buffer.from(sent.headers.get("x-warden-signature-ed25519")!, "base64")))
    const event = JSON.parse(sent.body)
    assert.equal(event.type, "license.created")
    assert.equal(event.id, sent.headers.get("x-warden-event-id"))
    assert.equal(event.data.license.id, license.id)
    assert.equal(event.data.license.check_url, `${ORIGIN}/check/${license.key}`)

    await api("POST", `/licenses/${license.id}/status`, { status: "suspended" })
    await api("POST", `/licenses/${license.id}/renew`, { days: 10 })
    await api("PATCH", `/licenses/${license.id}`, { name: "Copper Salon (renamed)" }) // license.updated: not subscribed
    await api("DELETE", `/licenses/${license.id}`)
    const types = fetches.sent.map((s) => JSON.parse(s.body).type)
    assert.deepEqual(types, ["license.created", "license.status_changed", "license.renewed", "license.deleted"])
    const statusChange = JSON.parse(fetches.sent[1].body)
    assert.deepEqual([statusChange.data.previous_status, statusChange.data.license.status], ["active", "suspended"])
    assert.equal(JSON.parse(fetches.sent[3].body).data.license.name, "Copper Salon (renamed)")
    assert.ok((await deliveries()).every((d: any) => d.state === "delivered" && d.attempts === 1))
    assert.equal(hook.events.length, 4)
  } finally {
    fetches.restore()
  }
})

test("failed deliveries are retried with increasing delays, then marked failed; they can be retried by hand", async () => {
  const { env, api, deliveries } = await setup()
  const fetches = mockFetch(() => new Response("maintenance", { status: 503 }))
  try {
    const hook = (await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.created"] })).json
    await api("POST", "/licenses", { name: "Maple Dental" })
    let [row] = await deliveries()
    assert.deepEqual([row.state, row.attempts, row.last_status], ["pending", 1, 503])
    assert.equal(row.last_error, "Response: maintenance")
    // Not due yet: nothing is sent.
    assert.equal(await deliverDue(env, row.created_at + RETRY_DELAYS_MS[0] - 1), 0)
    let at = row.next_attempt_at
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      assert.equal(await deliverDue(env, at), 1)
      ;[row] = await deliveries()
      at = row.next_attempt_at
    }
    assert.deepEqual([row.state, row.attempts], ["failed", MAX_ATTEMPTS])
    assert.equal(fetches.sent.length, MAX_ATTEMPTS)

    const list = await api("GET", `/webhooks/${hook.id}/deliveries`)
    assert.deepEqual([list.json.data[0].state, list.json.next], ["failed", null])
    fetches.restore()
    const ok = mockFetch()
    try {
      const retried = await api("POST", `/webhooks/${hook.id}/deliveries/${row.id}/retry`)
      assert.equal(retried.status, 202)
      ;[row] = await deliveries()
      assert.equal(row.state, "delivered")
      assert.equal((await api("POST", `/webhooks/${hook.id}/deliveries/${row.id}/retry`)).json.error.code, "cannot_retry")
    } finally {
      ok.restore()
    }
  } finally {
    fetches.restore()
  }
})

test("a test event goes to one endpoint now, whatever its events", async () => {
  const { api } = await setup()
  const fetches = mockFetch(() => new Response(null, { status: 204 }))
  try {
    const hook = (await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.expired"], enabled: false })).json
    const result = await api("POST", `/webhooks/${hook.id}/test`)
    assert.deepEqual([result.json.event, result.json.state, result.json.last_status], ["webhook.test", "delivered", 204])
    assert.equal(fetches.sent.length, 1)
  } finally {
    fetches.restore()
  }
})

test("time-based events: grace period started, expired and no recent check, each reported once", async () => {
  const { env, api, deliveries } = await setup()
  const fetches = mockFetch()
  try {
    await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.grace_period_started", "license.expired", "license.silent"] })
    const now = Date.now()
    const graced = await createLicense(env, { ...base, name: "In grace", expires_at: now - DAY, grace_days: 5 })
    const lapsed = await createLicense(env, { ...base, name: "Lapsed", expires_at: now - DAY })
    const done = await createLicense(env, { ...base, name: "Paid in full", status: "completed", expires_at: now - DAY })
    const quiet = await createLicense(env, { ...base, name: "Quiet" })
    await env.DB.prepare("UPDATE licenses SET created_at = ?, last_check_at = ? WHERE id = ?").bind(now - 10 * DAY, now - 4 * DAY, quiet.id).run()
    await env.DB.prepare("UPDATE licenses SET created_at = ?, last_check_at = ? WHERE id IN (?, ?, ?)").bind(now - 10 * DAY, now, graced.id, lapsed.id, done.id).run()

    const kinds = async () => (await deliveries()).map((d: any) => `${d.event}:${JSON.parse(d.payload).data.license.name}`).sort()
    assert.equal(await scanLicenseEvents(env, now), 3)
    assert.deepEqual(await kinds(), ["license.expired:Lapsed", "license.grace_period_started:In grace", "license.silent:Quiet"])
    const expiredEvent = (await deliveries()).find((d: any) => d.event === "license.expired")
    assert.deepEqual([JSON.parse(expiredEvent.payload).data.previous_status, JSON.parse(expiredEvent.payload).data.license.status], ["active", "expired"])

    // A second run reports nothing new.
    assert.equal(await scanLicenseEvents(env, now + 60_000), 0)
    // Once the grace period is over, the expiry is reported. The completed licence, still valid, has not been checked
    // for five days by then.
    assert.equal(await scanLicenseEvents(env, now + 5 * DAY), 2)
    assert.ok((await kinds()).includes("license.expired:In grace"))
    assert.ok((await kinds()).includes("license.silent:Paid in full"))
    // A renewed licence that expires again is reported again; a new check re-arms "no recent check".
    await env.DB.prepare("UPDATE licenses SET expires_at = ? WHERE id = ?").bind(now + 6 * DAY, lapsed.id).run()
    await env.DB.prepare("UPDATE licenses SET last_check_at = ? WHERE id = ?").bind(now + 2 * DAY, quiet.id).run()
    assert.equal(await scanLicenseEvents(env, now + 7 * DAY), 2)
    assert.equal((await getLicense(env, done.id))!.expired_notified_for, done.expires_at) // no expiry rule: marked, not reported
    // The scheduled run then sends them.
    assert.equal(await deliverDue(env, now + 7 * DAY), 7)
    assert.equal(fetches.sent.length, 7)
  } finally {
    fetches.restore()
  }
})

test("licences already reported in their grace period do not hold up the expiry events of others", async () => {
  const { env, api, deliveries } = await setup()
  await api("POST", "/webhooks", { url: "https://hooks.example.com/w", events: ["license.grace_period_started", "license.expired"] })
  const now = Date.now()
  for (const name of ["Grace 1", "Grace 2", "Grace 3"]) await createLicense(env, { ...base, name, expires_at: now - DAY, grace_days: 30 })
  // The first run reports the three grace periods; later runs, two licences at a time, must still reach the lapsed one.
  assert.equal(await scanLicenseEvents(env, now, 10), 3)
  await createLicense(env, { ...base, name: "Lapsed", expires_at: now - DAY })
  assert.equal(await scanLicenseEvents(env, now + 60_000, 2), 1)
  assert.ok((await deliveries()).some((d: any) => d.event === "license.expired" && JSON.parse(d.payload).data.license.name === "Lapsed"))
})
