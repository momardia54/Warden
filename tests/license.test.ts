import { test } from "node:test"
import assert from "node:assert/strict"
import { buildCheckResponse, domainAllowed, generateLicenseKey, KEY_PATTERN, normalizeDomain, parseDomains } from "../app/lib/license.ts"
import { DEFAULT_STATUSES, effectiveStatusKey } from "../app/lib/statuses.ts"

const DAY = 86_400_000

test("keys match the pattern and are unique", () => {
  const keys = new Set(Array.from({ length: 500 }, () => generateLicenseKey()))
  assert.equal(keys.size, 500)
  for (const k of keys) assert.match(k, KEY_PATTERN)
})

test("an active licence past its end date is expired; other statuses are unchanged", () => {
  const now = Date.now()
  assert.equal(effectiveStatusKey({ status: "active", expires_at: now - 1 }, DEFAULT_STATUSES, now), "expired")
  assert.equal(effectiveStatusKey({ status: "active", expires_at: now + DAY }, DEFAULT_STATUSES, now), "active")
  assert.equal(effectiveStatusKey({ status: "active", expires_at: null }, DEFAULT_STATUSES, now), "active")
  assert.equal(effectiveStatusKey({ status: "suspended", expires_at: now - DAY }, DEFAULT_STATUSES, now), "suspended")
  assert.equal(effectiveStatusKey({ status: "garbage", expires_at: null }, DEFAULT_STATUSES, now), "garbage") // an unknown status is kept as it is, and never grants access
})

test("domains are normalised and matched with subdomains", () => {
  assert.equal(normalizeDomain("https://WWW.HarborStudio.com/path?x=1"), "harborstudio.com")
  assert.equal(normalizeDomain("not a domain!"), null)
  assert.deepEqual(parseDomains("harborstudio.com, www.staging.harborstudio.com"), ["harborstudio.com", "staging.harborstudio.com"])
  assert.equal(domainAllowed([], null), true)
  assert.equal(domainAllowed(["harborstudio.com"], "shop.harborstudio.com"), true)
  assert.equal(domainAllowed(["harborstudio.com"], "evilharborstudio.com"), false)
  assert.equal(domainAllowed(["harborstudio.com"], null), false)
})

test("answers", () => {
  const now = Date.parse("2026-10-10T00:00:00Z")
  const base = { name: "Harbor Studio", status: "active", expires_at: null, domains: "", message: "" }
  assert.deepEqual([buildCheckResponse(base, null, now, [], DEFAULT_STATUSES).valid, buildCheckResponse(base, null, now, [], DEFAULT_STATUSES).status], [true, "active"])
  assert.equal(buildCheckResponse(null, null, now, [], DEFAULT_STATUSES).status, "unknown")
  assert.equal(buildCheckResponse({ ...base, status: "suspended", message: "Payment late" }, null, now, [], DEFAULT_STATUSES).message, "Payment late")
  assert.equal(buildCheckResponse({ ...base, status: "disabled" }, null, now, [], DEFAULT_STATUSES).valid, false)
  assert.equal(buildCheckResponse({ ...base, expires_at: now - 1 }, null, now, [], DEFAULT_STATUSES).status, "expired")
  const locked = { ...base, domains: "harborstudio.com" }
  assert.equal(buildCheckResponse(locked, "harborstudio.com", now, [], DEFAULT_STATUSES).valid, true)
  assert.equal(buildCheckResponse(locked, "other.com", now, [], DEFAULT_STATUSES).status, "domain_mismatch")
})
