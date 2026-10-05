import { domainAllowed, parseDomains } from "./license"
import { defaultStatusKey, effectiveStatusKey, type StatusSet } from "./statuses"

/** 100 MB: the largest request body a Worker accepts on the Free plan. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

/** The statuses a new file is released in unless specified otherwise: those that grant access and do not expire into another status. */
export function defaultReleaseStatuses(set: StatusSet): string[] {
  const keys = set.filter((s) => s.grants_access).map((s) => s.key)
  return keys.length > 0 ? keys : [defaultStatusKey(set)]
}

/** Returns a safe download name: no path segments, no control or reserved characters, at most 150 characters. Null if nothing is left. */
export function cleanFileName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? ""
  const name = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").trim().replace(/^\.+/, "").slice(0, 150)
  return name || null
}

export type FileAccess = { allowed: boolean; status: string; message: string }

type LicenseLike = { status: string; expires_at: number | null; domains: string }
type ReleaseRule = { statuses: string[]; check_domain: boolean }

/**
 * Decides whether a file can be downloaded now. The licence's effective status must be one of the file's
 * release statuses and, when `check_domain` is set and the licence lists domains, the domain must match.
 * `skipDomainCheck` is for the dashboard, where there is no requesting site. `set` is the status set of the licence;
 * `labels` is the set the file's release statuses belong to (its owner's), used to name them in the message.
 */
export function evaluateFileAccess(license: LicenseLike, file: ReleaseRule, domain: string | null, now: number, skipDomainCheck: boolean, set: StatusSet, labels: StatusSet = set): FileAccess {
  const status = effectiveStatusKey(license, set, now)
  if (!file.statuses.includes(status)) {
    const labelled = file.statuses.map((k) => labels.find((s) => s.key === k)?.label ?? k).join(", ")
    return { allowed: false, status, message: `This file is only available when the licence status is: ${labelled}.` }
  }
  if (file.check_domain && !skipDomainCheck && !domainAllowed(parseDomains(license.domains), domain)) {
    return { allowed: false, status: "domain_mismatch", message: "This licence is not valid for this domain." }
  }
  return { allowed: true, status, message: "" }
}
