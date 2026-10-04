export const STATUSES = ["pending", "active", "completed", "suspended", "disabled", "expired"] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  active: "Active",
  completed: "Completed",
  suspended: "Suspended",
  disabled: "Disabled",
  expired: "Expired",
}

/** Display label for any result the check endpoint can return, including the ones that are not stored statuses. */
export function checkResultLabel(status: string | null): string {
  if (status === "domain_mismatch") return "Wrong domain"
  if (status === "unknown") return "Unknown key"
  return status && isStatus(status) ? STATUS_LABEL[status] : (status ?? "")
}

export const STATUS_HINT: Record<Status, string> = {
  pending: "Created but not in effect yet, for example before the first payment is received.",
  active: "In effect. The site runs normally.",
  completed: "Paid in full. Permanent: the expiry date no longer applies.",
  suspended: "Temporarily on hold, for example for a late payment. Set to Active to resume.",
  disabled: "Permanently switched off.",
  expired: "Past its expiry date. Set automatically.",
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
}

/** Uppercase letters and digits without the look-alikes 0, O, 1, I and L. */
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
const KEY_PREFIX = "WRD"

/** Generates a key in the format WRD-XXXXX-XXXXX-XXXXX-XXXXX (20 random characters, about 98 bits of entropy). */
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

/** The status reported to sites. An active licence past its expiry date is reported as "expired". */
export function effectiveStatus(license: { status: string; expires_at: number | null }, now = Date.now()): Status {
  const status = isStatus(license.status) ? license.status : "disabled"
  if (status === "active" && license.expires_at !== null && license.expires_at <= now) return "expired"
  return status
}

/** True for the statuses under which a site may run: active and completed. */
export function grantsAccess(status: string): boolean {
  return status === "active" || status === "completed"
}

export function parseDomains(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter((d): d is string => Boolean(d))
}

/** Reduces a URL or host to a bare lowercase domain without scheme, path, port or leading "www.". Returns null if invalid. */
export function normalizeDomain(raw: string): string | null {
  let host = raw.trim().toLowerCase()
  if (!host) return null
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "")
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) ? host : null
}

/** True if the licence has no domain restriction, or the domain is an allowed domain or a subdomain of one. */
export function domainAllowed(allowed: string[], domain: string | null): boolean {
  if (allowed.length === 0) return true
  if (!domain) return false
  const d = normalizeDomain(domain)
  if (!d) return false
  return allowed.some((a) => d === a || d.endsWith(`.${a}`))
}

export type CheckResponse = {
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
  completed: "",
  pending: "This licence is not active yet.",
  suspended: "This licence is suspended.",
  disabled: "This licence has been disabled.",
  expired: "This licence has expired.",
  domain_mismatch: "This licence is not valid for this domain.",
  unknown: "Unknown licence.",
}

/** Builds the JSON response of the check endpoint. Pure function. */
export function buildCheckResponse(license: Row | null, domain: string | null, now = Date.now()): CheckResponse {
  const checked_at = new Date(now).toISOString()
  if (!license) return { valid: false, status: "unknown", message: DEFAULT_MESSAGE.unknown, checked_at }
  const status = effectiveStatus(license, now)
  const base = { name: license.name, expires_at: license.expires_at ? new Date(license.expires_at).toISOString() : null, checked_at }
  if (grantsAccess(status) && !domainAllowed(parseDomains(license.domains), domain)) {
    return { ...base, valid: false, status: "domain_mismatch", message: DEFAULT_MESSAGE.domain_mismatch }
  }
  return { ...base, valid: grantsAccess(status), status, message: license.message.trim() || DEFAULT_MESSAGE[status] }
}

/** API key permission levels, lowest first: read (GET only), manage (also create, edit, set status, renew), full (also delete licences and regenerate keys). */
export const SCOPES = ["read", "manage", "full"] as const
export type Scope = (typeof SCOPES)[number]
