import { effectiveStatusKey, findStatus, grantsAccess, type StatusSet } from "./statuses"

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
  /** A licence status key, or one of "unknown", "domain_mismatch" and "site_limit_reached". */
  status: string
  message: string
  name?: string
  app?: { slug: string; name: string } | null
  expires_at?: string | null
  checked_at: string
}

type LicenseForCheck = {
  name: string
  status: string
  expires_at: number | null
  domains: string
  message: string
  max_sites?: number | null
  app_slug?: string | null
  app_name?: string | null
}

const MESSAGE: Record<string, string> = {
  domain_mismatch: "This licence is not valid for this domain.",
  unknown: "Unknown licence.",
}

/**
 * Builds the JSON response of the check endpoint. Pure function.
 * `activatedDomains` are the domains the licence has already been used on; they matter only when the licence
 * has a site limit. `statuses` is the status set of the licence's app (or the default set).
 */
export function buildCheckResponse(license: LicenseForCheck | null, domain: string | null, now: number, activatedDomains: string[], statuses: StatusSet): CheckResponse {
  const checked_at = new Date(now).toISOString()
  if (!license) return { valid: false, status: "unknown", message: MESSAGE.unknown, checked_at }
  const status = effectiveStatusKey(license, statuses, now)
  const base = {
    name: license.name,
    app: license.app_slug ? { slug: license.app_slug, name: license.app_name ?? license.app_slug } : null,
    expires_at: license.expires_at ? new Date(license.expires_at).toISOString() : null,
    checked_at,
  }
  if (grantsAccess(statuses, status)) {
    if (!domainAllowed(parseDomains(license.domains), domain)) {
      return { ...base, valid: false, status: "domain_mismatch", message: MESSAGE.domain_mismatch }
    }
    const limit = license.max_sites ?? null
    if (limit !== null) {
      const normalized = domain ? normalizeDomain(domain) : null
      if (!normalized) {
        return { ...base, valid: false, status: "domain_mismatch", message: `This licence is limited to ${limit} site${limit === 1 ? "" : "s"}. Send the site's domain with the request (?domain=).` }
      }
      if (!activatedDomains.includes(normalized) && activatedDomains.length >= limit) {
        return { ...base, valid: false, status: "site_limit_reached", message: `This licence is already in use on the maximum number of sites (${limit}).` }
      }
    }
  }
  return { ...base, valid: grantsAccess(statuses, status), status, message: license.message.trim() || (findStatus(statuses, status)?.check_message ?? "") }
}

/** API key permission levels, lowest first: read (GET only), manage (also create, edit, set status, renew), full (also delete licences and regenerate keys). */
export const SCOPES = ["read", "manage", "full"] as const
export type Scope = (typeof SCOPES)[number]
