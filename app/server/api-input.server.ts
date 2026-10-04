import { isStatus, normalizeDomain, parseDomains, STATUSES } from "../lib/license"
import type { AppInput } from "./apps.server"
import { MAX_DURATION_DAYS } from "./apps.server"
import { parseOptionalCount, validEmail, type LicenseInput } from "./licenses.server"
import { isValidSlug, slugify } from "../lib/apps"
import { fail, parseExpiry, trimmed } from "./api-http.server"

type Parsed<T> = { input: T } | { response: Response }

const STORED_STATUSES = STATUSES.filter((s) => s !== "expired")

/** Merges a JSON body over `base` (an existing licence, or the defaults for a new one) and validates it. */
export function applyLicenseBody(body: Record<string, unknown>, base: LicenseInput): Parsed<LicenseInput> {
  const input = { ...base }
  if ("name" in body) {
    const name = trimmed(body.name, 120)
    if (!name) return { response: fail(422, "invalid_name", "name must be a non-empty string of at most 120 characters.") }
    input.name = name
  }
  for (const [field, max] of [["customer_name", 120], ["message", 300], ["notes", 4000]] as const) {
    if (field in body) {
      const value = trimmed(body[field], max)
      if (value === null) return { response: fail(422, `invalid_${field}`, `${field} must be a string.`) }
      input[field] = value
    }
  }
  if ("customer_email" in body) {
    const email = trimmed(body.customer_email, 200)
    if (email === null || !validEmail(email)) return { response: fail(422, "invalid_customer_email", "customer_email must be a valid email address.") }
    input.customer_email = email
  }
  if ("status" in body) {
    if (!isStatus(body.status) || body.status === "expired") {
      return { response: fail(422, "invalid_status", `status must be one of: ${STORED_STATUSES.join(", ")}. "expired" follows from the expiry date and cannot be set.`) }
    }
    input.status = body.status
  }
  if ("expires_at" in body) {
    const expiry = parseExpiry(body.expires_at)
    if (expiry === "invalid") return { response: fail(422, "invalid_expires_at", "expires_at must be null, a date (YYYY-MM-DD) or an ISO date-time.") }
    input.expires_at = expiry
  } else if ("duration_days" in body) {
    const days = Number(body.duration_days)
    if (!Number.isInteger(days) || days < 1 || days > MAX_DURATION_DAYS) {
      return { response: fail(422, "invalid_duration_days", `duration_days must be a whole number from 1 to ${MAX_DURATION_DAYS}.`) }
    }
    input.expires_at = Date.now() + days * 86_400_000
  }
  if ("max_sites" in body) {
    const sites = parseOptionalCount(body.max_sites)
    if (sites === "invalid") return { response: fail(422, "invalid_max_sites", "max_sites must be a whole number of 1 or more, or null for unlimited.") }
    input.max_sites = sites
  }
  if ("domains" in body) {
    const list = Array.isArray(body.domains) ? body.domains : typeof body.domains === "string" ? body.domains.split(/[\s,]+/).filter(Boolean) : null
    if (!list || list.some((d) => typeof d !== "string" || !normalizeDomain(d))) {
      return { response: fail(422, "invalid_domains", "domains must be an array of valid domain names, or a comma separated string.") }
    }
    input.domains = parseDomains((list as string[]).join(" ")).join(", ")
  }
  return { input }
}

/** Merges a JSON body over `base` and validates an app. A missing slug is generated from the name. */
export function applyAppBody(body: Record<string, unknown>, base: AppInput): Parsed<AppInput> {
  const input = { ...base }
  if ("name" in body) {
    const name = trimmed(body.name, 80)
    if (!name) return { response: fail(422, "invalid_name", "name must be a non-empty string of at most 80 characters.") }
    input.name = name
  }
  if ("slug" in body) {
    const slug = trimmed(body.slug, 48)?.toLowerCase() ?? ""
    if (!isValidSlug(slug)) return { response: fail(422, "invalid_slug", "slug must be 2 to 48 characters: lowercase letters, digits and single hyphens.") }
    input.slug = slug
  } else if (!input.slug) {
    input.slug = slugify(input.name)
    if (!isValidSlug(input.slug)) return { response: fail(422, "invalid_slug", "A slug could not be generated from the name. Send a slug.") }
  }
  for (const [field, max] of [["description", 500], ["default_message", 300], ["notes", 4000]] as const) {
    if (field in body) {
      const value = trimmed(body[field], max)
      if (value === null) return { response: fail(422, `invalid_${field}`, `${field} must be a string.`) }
      input[field] = value
    }
  }
  if ("default_status" in body) {
    if (!isStatus(body.default_status) || body.default_status === "expired") {
      return { response: fail(422, "invalid_default_status", `default_status must be one of: ${STORED_STATUSES.join(", ")}.`) }
    }
    input.default_status = body.default_status
  }
  if ("default_duration_days" in body) {
    const days = parseOptionalCount(body.default_duration_days, MAX_DURATION_DAYS)
    if (days === "invalid") return { response: fail(422, "invalid_default_duration_days", `default_duration_days must be a whole number from 1 to ${MAX_DURATION_DAYS}, or null for no expiry.`) }
    input.default_duration_days = days
  }
  if ("default_max_sites" in body) {
    const sites = parseOptionalCount(body.default_max_sites)
    if (sites === "invalid") return { response: fail(422, "invalid_default_max_sites", "default_max_sites must be a whole number of 1 or more, or null for unlimited.") }
    input.default_max_sites = sites
  }
  return { input }
}
