/** Colours offered as presets in the colour picker. Any hex colour can be used. */
export const COLOR_PRESETS = [
  { label: "Green", value: "#16a34a" },
  { label: "Teal", value: "#0d9488" },
  { label: "Blue", value: "#0284c7" },
  { label: "Purple", value: "#7c3aed" },
  { label: "Pink", value: "#db2777" },
  { label: "Amber", value: "#d97706" },
  { label: "Red", value: "#dc2626" },
  { label: "Grey", value: "#6b7280" },
] as const

export const DEFAULT_COLOR = "#6b7280"

/** A colour as #rrggbb. */
export const COLOR_FORMAT = /^#[0-9a-fA-F]{6}$/

export function isColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_FORMAT.test(value)
}

/** One licence status. A set of these defines the statuses available to a licence. */
export type StatusDef = {
  /** Stable identifier stored on licences and in file release rules. Cannot be changed after creation. */
  key: string
  label: string
  description: string
  /** Badge colour as #rrggbb. */
  color: string
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
    if (!isColor(s.color)) return `"${s.label}" has an invalid colour.`
  }
  if (set.filter((s) => s.is_default).length !== 1) return "Exactly one status must be the default for new licences."
  for (const s of set) {
    if (s.on_expiry !== null && (s.on_expiry === s.key || !keys.has(s.on_expiry))) return `"${s.label}" has an invalid expiry rule.`
  }
  return null
}

/** The statuses a new set starts with. Mirrors the rows seeded by migration 0006. */
export const DEFAULT_STATUSES: StatusSet = [
  { key: "pending", label: "Pending", description: "Created but not in effect yet, for example before the first payment is received.", color: "#6b7280", grants_access: false, on_expiry: null, check_message: "This licence is not active yet.", is_default: false, position: 1 },
  { key: "active", label: "Active", description: "In effect. The site runs normally.", color: "#16a34a", grants_access: true, on_expiry: "expired", check_message: "", is_default: true, position: 2 },
  { key: "completed", label: "Completed", description: "Paid in full. Permanent: the expiry date no longer applies.", color: "#16a34a", grants_access: true, on_expiry: null, check_message: "", is_default: false, position: 3 },
  { key: "suspended", label: "Suspended", description: "Temporarily on hold, for example for a late payment. Set to Active to resume.", color: "#d97706", grants_access: false, on_expiry: null, check_message: "This licence is suspended.", is_default: false, position: 4 },
  { key: "disabled", label: "Disabled", description: "Permanently switched off.", color: "#dc2626", grants_access: false, on_expiry: null, check_message: "This licence has been disabled.", is_default: false, position: 5 },
  { key: "expired", label: "Expired", description: "Past its expiry date. Applied automatically to licences whose expiry date has passed.", color: "#dc2626", grants_access: false, on_expiry: null, check_message: "This licence has expired.", is_default: false, position: 6 },
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

// ---- editing a set in memory ----------------------------------------------------------
// These functions do not touch the database. The server uses them for stored sets, and the create forms use them for a
// set that is still a draft.

export type StatusFields = {
  key?: string
  label: string
  description: string
  color: string
  grants_access: boolean
  on_expiry: string | null
  check_message: string
  is_default?: boolean
}

type Result = { set: StatusSet } | { error: string }

/** Re-numbers the positions of a set after it changed. */
const renumber = (set: StatusSet): StatusSet => set.map((s, index) => ({ ...s, position: index + 1 }))

export function addToSet(set: StatusSet, input: StatusFields): Result {
  const key = input.key?.trim() || keyFromLabel(input.label)
  if (!isValidKey(key)) return { error: "The identifier must start with a letter and use lowercase letters, digits and underscores (up to 32). \"unknown\", \"domain_mismatch\" and \"site_limit_reached\" are reserved." }
  if (findStatus(set, key)) return { error: `A status with the identifier "${key}" already exists.` }
  const added: StatusDef = {
    key, label: input.label.trim(), description: input.description, color: input.color, grants_access: input.grants_access, on_expiry: input.on_expiry,
    check_message: input.check_message, is_default: input.is_default === true, position: set.length + 1,
  }
  const next = renumber([...set.map((s) => (added.is_default ? { ...s, is_default: false } : s)), added])
  const problem = validateStatusSet(next)
  return problem ? { error: problem } : { set: next }
}

export function updateInSet(set: StatusSet, key: string, changes: Partial<StatusFields>): Result {
  if (!findStatus(set, key)) return { error: "Status not found." }
  const next = set.map((s) => {
    if (s.key !== key) return changes.is_default ? { ...s, is_default: false } : s
    return {
      ...s,
      label: changes.label !== undefined ? changes.label.trim() : s.label,
      description: changes.description ?? s.description,
      color: changes.color ?? s.color,
      grants_access: changes.grants_access ?? s.grants_access,
      on_expiry: changes.on_expiry === undefined ? s.on_expiry : changes.on_expiry,
      check_message: changes.check_message ?? s.check_message,
      is_default: changes.is_default === undefined ? s.is_default : changes.is_default,
    }
  })
  // Clearing the default flag of the only default would leave the set without one: keep it.
  if (!next.some((s) => s.is_default)) next.find((s) => s.key === key)!.is_default = true
  const problem = validateStatusSet(next)
  return problem ? { error: problem } : { set: renumber(next) }
}

/** Removes a status and clears the expiry rules that pointed to it. The default moves to `newDefault` (or the first status) if it was removed. */
export function removeFromSet(set: StatusSet, key: string, newDefault?: string | null): Result {
  if (!findStatus(set, key)) return { error: "Status not found." }
  if (set.length === 1) return { error: "A set needs at least one status." }
  const remaining = set.filter((s) => s.key !== key).map((s) => ({ ...s, on_expiry: s.on_expiry === key ? null : s.on_expiry }))
  if (!remaining.some((s) => s.is_default)) remaining.find((s) => s.key === (newDefault ?? remaining[0].key))!.is_default = true
  const problem = validateStatusSet(remaining)
  return problem ? { error: problem } : { set: renumber(remaining) }
}

export function moveInSet(set: StatusSet, key: string, direction: "up" | "down"): StatusSet {
  const index = set.findIndex((s) => s.key === key)
  const target = direction === "up" ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= set.length) return set
  const next = [...set]
  ;[next[index], next[target]] = [next[target], next[index]]
  return renumber(next)
}

/** Reads a set sent by a create form (JSON). Returns the validated set, or an error message. */
export function parseStatusDraft(raw: string): { set: StatusSet } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { error: "The statuses could not be read." }
  }
  if (!Array.isArray(value)) return { error: "The statuses could not be read." }
  const set: StatusSet = []
  for (const item of value) {
    if (typeof item !== "object" || item === null) return { error: "The statuses could not be read." }
    const s = item as Record<string, unknown>
    if (typeof s.key !== "string" || typeof s.label !== "string" || !isColor(s.color)) return { error: "A status is missing its identifier, label or colour." }
    set.push({
      key: s.key,
      label: s.label.trim().slice(0, 40),
      description: typeof s.description === "string" ? s.description.trim().slice(0, 200) : "",
      color: s.color.toLowerCase(),
      grants_access: s.grants_access === true,
      on_expiry: typeof s.on_expiry === "string" && s.on_expiry ? s.on_expiry : null,
      check_message: typeof s.check_message === "string" ? s.check_message.trim().slice(0, 300) : "",
      is_default: s.is_default === true,
      position: set.length + 1,
    })
  }
  const problem = validateStatusSet(set)
  return problem ? { error: problem } : { set }
}
