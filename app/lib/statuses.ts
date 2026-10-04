/** Visual style of a status badge. */
export const TONES = ["success", "warning", "danger", "info", "neutral"] as const
export type Tone = (typeof TONES)[number]

export const TONE_LABEL: Record<Tone, string> = { success: "Green", warning: "Amber", danger: "Red", info: "Blue", neutral: "Grey" }

/** One licence status. A set of these defines the statuses available to a licence. */
export type StatusDef = {
  /** Stable identifier stored on licences and in file release rules. Cannot be changed after creation. */
  key: string
  label: string
  description: string
  tone: Tone
  /** Sites may run under this status: the check response has valid = true. */
  grants_access: boolean
  /** The status a licence takes on, as seen by sites, once its expiry date has passed. Null: the expiry date does not apply. */
  on_expiry: string | null
  /** Message returned to sites for this status when the licence has no public message of its own. */
  check_message: string
  /** New licences start with this status. Exactly one per set. */
  is_default: boolean
  position: number
}

export type StatusSet = StatusDef[]

/** Keys the check endpoint uses for results that are not licence statuses. */
export const RESERVED_KEYS = ["unknown", "domain_mismatch", "site_limit_reached"]

export const KEY_FORMAT = /^[a-z][a-z0-9_]{0,31}$/

export function isTone(value: unknown): value is Tone {
  return typeof value === "string" && (TONES as readonly string[]).includes(value)
}

/** Derives a status key from a label: lowercase letters, digits and underscores, starting with a letter. */
export function keyFromLabel(label: string): string {
  const key = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[0-9_]+/, "")
    .replace(/_+$/, "")
  return key.slice(0, 32)
}

export function isValidKey(key: string): boolean {
  return KEY_FORMAT.test(key) && !RESERVED_KEYS.includes(key)
}

export function findStatus(set: StatusSet, key: string): StatusDef | undefined {
  return set.find((s) => s.key === key)
}

export function defaultStatusKey(set: StatusSet): string {
  return (set.find((s) => s.is_default) ?? set[0])?.key ?? ""
}

/** True if sites may run under the given status. Unknown statuses never grant access. */
export function grantsAccess(set: StatusSet, key: string): boolean {
  return findStatus(set, key)?.grants_access ?? false
}

/**
 * The status reported to sites. A licence whose status has an expiry rule and whose expiry date has passed is
 * reported with the status the rule points to (for example Active becomes Expired).
 */
export function effectiveStatusKey(license: { status: string; expires_at: number | null }, set: StatusSet, now = Date.now()): string {
  const def = findStatus(set, license.status)
  if (def?.on_expiry && license.expires_at !== null && license.expires_at <= now && findStatus(set, def.on_expiry)) return def.on_expiry
  return license.status
}

/** The statuses that move to `key` when their expiry date passes. */
export function expirySources(set: StatusSet, key: string): string[] {
  return set.filter((s) => s.on_expiry === key).map((s) => s.key)
}

export function statusLabel(set: StatusSet, key: string | null): string {
  if (!key) return ""
  if (key === "domain_mismatch") return "Wrong domain"
  if (key === "unknown") return "Unknown key"
  if (key === "site_limit_reached") return "Site limit reached"
  return findStatus(set, key)?.label ?? key
}

/** Returns an error message if the set cannot be used, otherwise null. */
export function validateStatusSet(set: StatusSet): string | null {
  if (set.length === 0) return "At least one status is required."
  if (set.length > 50) return "A set can have at most 50 statuses."
  const keys = new Set<string>()
  for (const s of set) {
    if (!isValidKey(s.key)) return `"${s.key}" is not a valid identifier.`
    if (keys.has(s.key)) return `The identifier "${s.key}" is used twice.`
    keys.add(s.key)
    if (!s.label.trim()) return "Every status needs a label."
  }
  if (set.filter((s) => s.is_default).length !== 1) return "Exactly one status must be the default for new licences."
  for (const s of set) {
    if (s.on_expiry !== null && (s.on_expiry === s.key || !keys.has(s.on_expiry))) return `"${s.label}" has an invalid expiry rule.`
  }
  return null
}

/** The statuses a new set starts with. Mirrors the rows seeded by migration 0006. */
export const DEFAULT_STATUSES: StatusSet = [
  { key: "pending", label: "Pending", description: "Created but not in effect yet, for example before the first payment is received.", tone: "neutral", grants_access: false, on_expiry: null, check_message: "This licence is not active yet.", is_default: false, position: 1 },
  { key: "active", label: "Active", description: "In effect. The site runs normally.", tone: "success", grants_access: true, on_expiry: "expired", check_message: "", is_default: true, position: 2 },
  { key: "completed", label: "Completed", description: "Paid in full. Permanent: the expiry date no longer applies.", tone: "success", grants_access: true, on_expiry: null, check_message: "", is_default: false, position: 3 },
  { key: "suspended", label: "Suspended", description: "Temporarily on hold, for example for a late payment. Set to Active to resume.", tone: "warning", grants_access: false, on_expiry: null, check_message: "This licence is suspended.", is_default: false, position: 4 },
  { key: "disabled", label: "Disabled", description: "Permanently switched off.", tone: "danger", grants_access: false, on_expiry: null, check_message: "This licence has been disabled.", is_default: false, position: 5 },
  { key: "expired", label: "Expired", description: "Past its expiry date. Applied automatically to licences whose expiry date has passed.", tone: "danger", grants_access: false, on_expiry: null, check_message: "This licence has expired.", is_default: false, position: 6 },
]

/** Parses a comma separated string or an array of keys into a de-duplicated list in the set's order. Null if empty or if a key is not in the set. */
export function parseStatusKeys(input: unknown, set: StatusSet): string[] | null {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : null
  if (!list) return null
  const values = list.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")).filter(Boolean)
  if (values.length === 0 || !values.every((v) => findStatus(set, v))) return null
  return set.filter((s) => values.includes(s.key)).map((s) => s.key)
}

/** Reads a stored comma separated list of keys, keeping the set's order. Keys that are no longer in the set are dropped. */
export function splitStatusKeys(stored: string, set: StatusSet): string[] {
  const keys = stored.split(",")
  return set.filter((s) => keys.includes(s.key)).map((s) => s.key)
}

export function describeStatusKeys(keys: string[], set: StatusSet): string {
  return keys.map((k) => statusLabel(set, k)).join(", ")
}
