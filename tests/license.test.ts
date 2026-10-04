import { test } from "node:test"
import assert from "node:assert/strict"
import { buildCheckResponse, domainAllowed, effectiveStatus, generateLicenseKey, KEY_PATTERN, normalizeDomain, parseDomains } from "../app/lib/license.ts"

const DAY = 86_400_000

test("keys match the pattern and are unique", () => {
  const keys = new Set(Array.from({ length: 500 }, () => generateLicenseKey()))
  assert.equal(keys.size, 500)
  for (const k of keys) assert.match(k, KEY_PATTERN)
})

test("an active licence past its end date is expired; other statuses are unchanged", () => {
  const now = Date.now()
  assert.equal(effectiveStatus({ status: "active", expires_at: now - 1 }, now), "expired")
  assert.equal(effectiveStatus({ status: "active", expires_at: now + DAY }, now), "active")
  assert.equal(effectiveStatus({ status: "active", expires_at: null }, now), "active")
  assert.equal(effectiveStatus({ status: "suspended", expires_at: now - DAY }, now), "suspended")
  assert.equal(effectiveStatus({ status: "garbage", expires_at: null }, now), "disabled")
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
  assert.deepEqual([buildCheckResponse(base, null, now).valid, buildCheckResponse(base, null, now).status], [true, "active"])
  assert.equal(buildCheckResponse(null, null, now).status, "unknown")
  assert.equal(buildCheckResponse({ ...base, status: "suspended", message: "Payment late" }, null, now).message, "Payment late")
  assert.equal(buildCheckResponse({ ...base, status: "disabled" }, null, now).valid, false)
  assert.equal(buildCheckResponse({ ...base, expires_at: now - 1 }, null, now).status, "expired")
  const locked = { ...base, domains: "harborstudio.com" }
  assert.equal(buildCheckResponse(locked, "harborstudio.com", now).valid, true)
  assert.equal(buildCheckResponse(locked, "other.com", now).status, "domain_mismatch")
})
