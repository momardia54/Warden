import { test } from "node:test"
import assert from "node:assert/strict"
import { buildAnswer, domainAllowed, effectiveStatus, generateLicenseKey, KEY_PATTERN, normalizeDomain, parseDomains } from "../app/lib/license.ts"

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
  assert.equal(normalizeDomain("https://WWW.OCWOF.org/path?x=1"), "ocwof.org")
  assert.equal(normalizeDomain("not a domain!"), null)
  assert.deepEqual(parseDomains("ocwof.org, www.staging.ocwof.org"), ["ocwof.org", "staging.ocwof.org"])
  assert.equal(domainAllowed([], null), true)
  assert.equal(domainAllowed(["ocwof.org"], "shop.ocwof.org"), true)
  assert.equal(domainAllowed(["ocwof.org"], "evilocwof.org"), false)
  assert.equal(domainAllowed(["ocwof.org"], null), false)
})

test("answers", () => {
  const now = Date.parse("2026-10-10T00:00:00Z")
  const base = { name: "OCWOF", status: "active", expires_at: null, domains: "", message: "" }
  assert.deepEqual([buildAnswer(base, null, now).valid, buildAnswer(base, null, now).status], [true, "active"])
  assert.equal(buildAnswer(null, null, now).status, "unknown")
  assert.equal(buildAnswer({ ...base, status: "suspended", message: "Payment late" }, null, now).message, "Payment late")
  assert.equal(buildAnswer({ ...base, status: "disabled" }, null, now).valid, false)
  assert.equal(buildAnswer({ ...base, expires_at: now - 1 }, null, now).status, "expired")
  const locked = { ...base, domains: "ocwof.org" }
  assert.equal(buildAnswer(locked, "ocwof.org", now).valid, true)
  assert.equal(buildAnswer(locked, "other.com", now).status, "domain_mismatch")
})
