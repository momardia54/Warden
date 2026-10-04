import { domainAllowed, effectiveStatus, isStatus, parseDomains, STATUSES, STATUS_LABEL, type Status } from "./license"

/** 100 MB: the largest request body a Worker accepts on the Free plan. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

/** Statuses a new file is released in unless specified otherwise. */
export const DEFAULT_RELEASE_STATUSES: Status[] = ["active", "completed"]

/** Parses a comma separated string or an array into a de-duplicated list in canonical order. Returns null if empty or invalid. */
export function parseStatuses(input: unknown): Status[] | null {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : null
  if (!list) return null
  const values = list.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")).filter(Boolean)
  if (values.length === 0 || !values.every(isStatus)) return null
  return STATUSES.filter((s) => values.includes(s))
}

/** Reads the stored comma separated list, ignoring unknown values. */
export function splitStatuses(stored: string): Status[] {
  return STATUSES.filter((s) => stored.split(",").includes(s))
}

export function describeStatuses(statuses: Status[]): string {
  return statuses.map((s) => STATUS_LABEL[s]).join(", ")
}

/** Returns a safe download name: no path segments, no control or reserved characters, at most 150 characters. Null if nothing is left. */
export function cleanFileName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? ""
  const name = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").trim().replace(/^\.+/, "").slice(0, 150)
  return name || null
}

export type FileAccess = { allowed: boolean; status: string; message: string }

type LicenseLike = { status: string; expires_at: number | null; domains: string }
type ReleaseRule = { statuses: Status[]; check_domain: boolean }

/**
 * Decides whether a file can be downloaded now. The licence's effective status must be one of the file's
 * release statuses and, when `check_domain` is set and the licence lists domains, the domain must match.
 * `skipDomainCheck` is for the dashboard, where there is no requesting site.
 */
export function evaluateFileAccess(license: LicenseLike, file: ReleaseRule, domain: string | null, now = Date.now(), skipDomainCheck = false): FileAccess {
  const status = effectiveStatus(license, now)
  if (!file.statuses.includes(status)) {
    return { allowed: false, status, message: `This file is only available when the licence status is: ${describeStatuses(file.statuses)}.` }
  }
  if (file.check_domain && !skipDomainCheck && !domainAllowed(parseDomains(license.domains), domain)) {
    return { allowed: false, status: "domain_mismatch", message: "This licence is not valid for this domain." }
  }
  return { allowed: true, status, message: "" }
}
