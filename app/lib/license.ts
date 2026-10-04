export const STATUSES = ["pending", "active", "suspended", "disabled", "expired"] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
  disabled: "Disabled",
  expired: "Expired",
}

/** Label for any status the check endpoint can answer, including the non-stored ones. */
export function answerLabel(status: string | null): string {
  if (status === "domain_mismatch") return "Wrong domain"
  if (status === "unknown") return "Unknown key"
  return status && isStatus(status) ? STATUS_LABEL[status] : (status ?? "")
}

export const STATUS_HINT: Record<Status, string> = {
  pending: "Created but not yet in force, for example waiting for the first payment.",
  active: "In force. The site should run normally.",
  suspended: "Temporarily stopped, for example a late payment. Set it back to active to resume.",
  disabled: "Switched off for good.",
  expired: "Past its end date.",
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
}

const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789" // no 0/O/1/I/L, easy to read out loud
const KEY_PREFIX = "WRD"

/** WRD-XXXXX-XXXXX-XXXXX-XXXXX: 20 random characters, about 98 bits. */
export function generateLicenseKey(random: Crypto = globalThis.crypto): string {
  const limit = 256 - (256 % KEY_ALPHABET.length)
  let chars = ""
  while (chars.length < 20) {
    for (const byte of random.getRandomValues(new Uint8Array(40))) {
      if (byte >= limit) continue
      chars += KEY_ALPHABET[byte % KEY_ALPHABET.length]
      if (chars.length === 20) break
    }
  }
  return [KEY_PREFIX, ...chars.match(/.{5}/g)!].join("-")
}

export const KEY_PATTERN = /^WRD(-[A-Z0-9]{5}){4}$/

/** What a site is told. `status` is the effective one: an active licence past its end date reads "expired". */
export function effectiveStatus(license: { status: string; expires_at: number | null }, now = Date.now()): Status {
  const status = isStatus(license.status) ? license.status : "disabled"
  if (status === "active" && license.expires_at !== null && license.expires_at <= now) return "expired"
  return status
}

export function parseDomains(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter((d): d is string => Boolean(d))
}

/** "https://www.HarborStudio.com/path" -> "harborstudio.com". The leading "www." is ignored so both forms match. */
export function normalizeDomain(raw: string): string | null {
  let host = raw.trim().toLowerCase()
  if (!host) return null
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "")
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) ? host : null
}

/** True when the licence has no domain list, or the site's domain (or a subdomain of one) is on it. */
export function domainAllowed(allowed: string[], domain: string | null): boolean {
  if (allowed.length === 0) return true
  if (!domain) return false
  const d = normalizeDomain(domain)
  if (!d) return false
  return allowed.some((a) => d === a || d.endsWith(`.${a}`))
}

export type CheckAnswer = {
  valid: boolean
  status: Status | "unknown" | "domain_mismatch"
  message: string
  name?: string
  expires_at?: string | null
  checked_at: string
}

type Row = { name: string; status: string; expires_at: number | null; domains: string; message: string }

const DEFAULT_MESSAGE: Record<string, string> = {
  active: "",
  pending: "This licence is not active yet.",
  suspended: "This licence is suspended.",
  disabled: "This licence has been disabled.",
  expired: "This licence has expired.",
  domain_mismatch: "This licence is not valid for this domain.",
  unknown: "Unknown licence.",
}

/** The JSON answer for one check. Pure, so it is easy to test. */
export function buildAnswer(license: Row | null, domain: string | null, now = Date.now()): CheckAnswer {
  const checked_at = new Date(now).toISOString()
  if (!license) return { valid: false, status: "unknown", message: DEFAULT_MESSAGE.unknown, checked_at }
  const status = effectiveStatus(license, now)
  const base = { name: license.name, expires_at: license.expires_at ? new Date(license.expires_at).toISOString() : null, checked_at }
  if (status === "active" && !domainAllowed(parseDomains(license.domains), domain)) {
    return { ...base, valid: false, status: "domain_mismatch", message: DEFAULT_MESSAGE.domain_mismatch }
  }
  return { ...base, valid: status === "active", status, message: license.message.trim() || DEFAULT_MESSAGE[status] }
}

/** API key access levels, lowest first: read (GET), manage (create, edit, status, renew), full (also delete, regenerate key). */
export const SCOPES = ["read", "manage", "full"] as const
export type Scope = (typeof SCOPES)[number]
