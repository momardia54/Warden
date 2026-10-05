import {
  DEFAULT_COLOR, DEFAULT_STATUSES, defaultStatusKey, findStatus, isColor, isValidKey, keyFromLabel, validateStatusSet, type StatusDef, type StatusSet,
} from "../lib/statuses"

type Row = { app_id: string | null; license_id: string | null; key: string; label: string; description: string; color: string; grants_access: number; on_expiry: string | null; check_message: string; is_default: number; position: number }

const toDef = (r: Row): StatusDef => ({
  key: r.key,
  label: r.label,
  description: r.description,
  color: isColor(r.color) ? r.color : DEFAULT_COLOR,
  grants_access: r.grants_access === 1,
  on_expiry: r.on_expiry,
  check_message: r.check_message,
  is_default: r.is_default === 1,
  position: r.position,
})

/**
 * The scope of a set of statuses: an app, or a single licence. A licence uses its own statuses if it has any, otherwise
 * its app's statuses if the app has any, otherwise the built-in defaults.
 */
export type StatusScope = { app: string } | { license: string }

type LicenseRef = { id: string; app_id: string | null }

/** Every customised set of statuses in the installation. Anything without a set uses the next level up. */
export type StatusSets = { byApp: Record<string, StatusSet>; byLicense: Record<string, StatusSet> }

export async function loadStatusSets(env: Env): Promise<StatusSets> {
  const rows = (await env.DB.prepare("SELECT * FROM statuses ORDER BY position, id").all<Row>()).results
  const sets: StatusSets = { byApp: {}, byLicense: {} }
  for (const row of rows) {
    if (row.license_id) (sets.byLicense[row.license_id] ??= []).push(toDef(row))
    else if (row.app_id) (sets.byApp[row.app_id] ??= []).push(toDef(row))
  }
  return sets
}

export function setForApp(sets: StatusSets, appId: string | null): StatusSet {
  return (appId && sets.byApp[appId]) || DEFAULT_STATUSES
}

/** The statuses that apply to a licence: its own, else its app's, else the defaults. */
export function setForLicense(sets: StatusSets, license: LicenseRef): StatusSet {
  return sets.byLicense[license.id] ?? setForApp(sets, license.app_id)
}

const scopeColumn = (scope: StatusScope) => ("app" in scope ? "app_id" : "license_id")
const scopeId = (scope: StatusScope) => ("app" in scope ? scope.app : scope.license)

async function loadScope(env: Env, scope: StatusScope): Promise<StatusSet> {
  const rows = (await env.DB.prepare(`SELECT * FROM statuses WHERE ${scopeColumn(scope)} = ? ORDER BY position, id`).bind(scopeId(scope)).all<Row>()).results
  return rows.map(toDef)
}

/** The statuses of an app: its own, or the defaults. */
export async function getStatusSetForApp(env: Env, appId: string | null): Promise<StatusSet> {
  if (!appId) return DEFAULT_STATUSES
  const own = await loadScope(env, { app: appId })
  return own.length > 0 ? own : DEFAULT_STATUSES
}

/** The statuses that apply to a licence: its own, else its app's, else the defaults. */
export async function getStatusSetForLicense(env: Env, license: LicenseRef): Promise<StatusSet> {
  const own = await loadScope(env, { license: license.id })
  return own.length > 0 ? own : getStatusSetForApp(env, license.app_id)
}

/** The set a scope falls back to when it has no statuses of its own: the app's (or the defaults) for a licence, the defaults for an app. */
async function parentSet(env: Env, scope: StatusScope): Promise<StatusSet> {
  if ("app" in scope) return DEFAULT_STATUSES
  const row = await env.DB.prepare("SELECT app_id FROM licenses WHERE id = ?").bind(scope.license).first<{ app_id: string | null }>()
  return getStatusSetForApp(env, row?.app_id ?? null)
}

export async function hasCustomSet(env: Env, scope: StatusScope): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT 1 AS found FROM statuses WHERE ${scopeColumn(scope)} = ? LIMIT 1`).bind(scopeId(scope)).first())
}

/** Where the statuses of a licence come from, for display. */
export async function statusSource(env: Env, license: LicenseRef): Promise<"licence" | "app" | "default"> {
  if (await hasCustomSet(env, { license: license.id })) return "licence"
  return license.app_id && (await hasCustomSet(env, { app: license.app_id })) ? "app" : "default"
}

export type StatusInput = {
  key?: string
  label: string
  description: string
  /** Badge colour as #rrggbb. */
  color: string
  grants_access: boolean
  on_expiry: string | null
  check_message: string
  is_default?: boolean
}

type Failure = { error: string }

function check(set: StatusSet): Failure | null {
  const problem = validateStatusSet(set)
  return problem ? { error: problem } : null
}

/** Writes a whole set for a scope, replacing what is stored. The caller has validated it. */
async function writeScope(env: Env, scope: StatusScope, set: StatusSet): Promise<void> {
  const column = scopeColumn(scope)
  const statements = [env.DB.prepare(`DELETE FROM statuses WHERE ${column} = ?`).bind(scopeId(scope))]
  set.forEach((s, index) => {
    statements.push(
      env.DB.prepare(`INSERT INTO statuses (${column}, key, label, description, color, grants_access, on_expiry, check_message, is_default, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        scopeId(scope), s.key, s.label, s.description, s.color, s.grants_access ? 1 : 0, s.on_expiry, s.check_message, s.is_default ? 1 : 0, index + 1
      )
    )
  })
  await env.DB.batch(statements)
}

export async function createStatus(env: Env, scope: StatusScope, input: StatusInput): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  if (set.length === 0) return { error: "Customise the statuses first." }
  const key = input.key?.trim() || keyFromLabel(input.label)
  if (!isValidKey(key)) return { error: "The identifier must start with a letter and use lowercase letters, digits and underscores (up to 32). \"unknown\", \"domain_mismatch\" and \"site_limit_reached\" are reserved." }
  if (findStatus(set, key)) return { error: `A status with the identifier "${key}" already exists.` }
  const next = [...set.map((s) => (input.is_default ? { ...s, is_default: false } : s)), { ...input, key, label: input.label.trim(), is_default: input.is_default === true, position: set.length + 1 }]
  const problem = check(next)
  if (problem) return problem
  await writeScope(env, scope, next)
  return { set: next }
}

export async function updateStatus(env: Env, scope: StatusScope, key: string, changes: Partial<StatusInput>): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
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
  const problem = check(next)
  if (problem) return problem
  await writeScope(env, scope, next)
  return { set: next }
}

/** Moves a status one place up or down. */
export async function moveStatus(env: Env, scope: StatusScope, key: string, direction: "up" | "down"): Promise<void> {
  const set = await loadScope(env, scope)
  const index = set.findIndex((s) => s.key === key)
  const target = direction === "up" ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= set.length) return
  ;[set[index], set[target]] = [set[target], set[index]]
  await writeScope(env, scope, set)
}

/** Applies a new order. `keys` must list every status of the set exactly once. */
export async function setStatusOrder(env: Env, scope: StatusScope, keys: string[]): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  if (keys.length !== set.length || new Set(keys).size !== keys.length || !keys.every((k) => findStatus(set, k))) {
    return { error: "keys must list every status of the set exactly once." }
  }
  const next = keys.map((k) => findStatus(set, k)!)
  await writeScope(env, scope, next)
  return { set: next }
}

// ---- which licences and files a set governs -----------------------------------------

/**
 * SQL condition (table alias l) for the licences whose statuses come from the scope: for an app, its licences that
 * have no statuses of their own; for a licence, that licence.
 */
function licenseFilter(scope: StatusScope): { sql: string; args: string[] } {
  return "app" in scope
    ? { sql: "(l.app_id = ? AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.license_id = l.id))", args: [scope.app] }
    : { sql: "l.id = ?", args: [scope.license] }
}

/** SQL condition (aliases f for files, l for the licence a file belongs to) for the files whose release rules use the scope's statuses. */
function fileFilter(scope: StatusScope): { sql: string; args: string[] } {
  return "app" in scope
    ? { sql: "(f.app_id = ? OR (l.app_id = ? AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.license_id = l.id)))", args: [scope.app, scope.app] }
    : { sql: "f.license_id = ?", args: [scope.license] }
}

/** Counts the licences and files that use a status within a scope. */
export async function statusUsage(env: Env, scope: StatusScope, key: string): Promise<{ licenses: number; files: number }> {
  const lf = licenseFilter(scope)
  const ff = fileFilter(scope)
  const licenses = await env.DB.prepare(`SELECT COUNT(*) AS c FROM licenses l WHERE l.status = ? AND ${lf.sql}`).bind(key, ...lf.args).first<{ c: number }>()
  const files = await env.DB.prepare(`SELECT COUNT(*) AS c FROM files f LEFT JOIN licenses l ON l.id = f.license_id WHERE (',' || f.statuses || ',') LIKE ? AND ${ff.sql}`).bind(`%,${key},%`, ...ff.args).first<{ c: number }>()
  return { licenses: licenses?.c ?? 0, files: files?.c ?? 0 }
}

/** Number of licences per stored status within a scope. */
export async function statusCounts(env: Env, scope: StatusScope): Promise<Record<string, number>> {
  const lf = licenseFilter(scope)
  const rows = (await env.DB.prepare(`SELECT l.status AS status, COUNT(*) AS c FROM licenses l WHERE ${lf.sql} GROUP BY l.status`).bind(...lf.args).all<{ status: string; c: number }>()).results
  return Object.fromEntries(rows.map((r) => [r.status, r.c]))
}

/** Replaces a removed status key in the release rules of a scope's files. A rule left empty gets the set's default status. */
async function rewriteFileRules(env: Env, scope: StatusScope, key: string, replacement: string | null, fallback: string): Promise<void> {
  const ff = fileFilter(scope)
  const rows = (await env.DB.prepare(`SELECT f.id AS id, f.statuses AS statuses FROM files f LEFT JOIN licenses l ON l.id = f.license_id WHERE (',' || f.statuses || ',') LIKE ? AND ${ff.sql}`).bind(`%,${key},%`, ...ff.args).all<{ id: string; statuses: string }>()).results
  for (const row of rows) {
    const keys = row.statuses.split(",").filter((k) => k !== key)
    if (replacement && !keys.includes(replacement)) keys.push(replacement)
    if (keys.length === 0) keys.push(fallback)
    await env.DB.prepare("UPDATE files SET statuses = ? WHERE id = ?").bind(keys.join(","), row.id).run()
  }
}

/**
 * Deletes a status. Licences of the scope that use it move to `moveTo` (required when any does); file release rules
 * and the app default that name it are updated, and expiry rules that pointed to it are cleared.
 */
export async function deleteStatus(env: Env, scope: StatusScope, key: string, moveTo: string | null): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  if (!findStatus(set, key)) return { error: "Status not found." }
  if (set.length === 1) return { error: "A set needs at least one status." }
  const usage = await statusUsage(env, scope, key)
  if (usage.licenses > 0 && !moveTo) return { error: `${usage.licenses} licence${usage.licenses === 1 ? "" : "s"} use this status. Choose a status to move them to.` }
  if (moveTo !== null && (moveTo === key || !findStatus(set, moveTo))) return { error: "Choose a different status of the same set to move licences to." }

  const remaining = set.filter((s) => s.key !== key).map((s) => ({ ...s, on_expiry: s.on_expiry === key ? null : s.on_expiry }))
  if (!remaining.some((s) => s.is_default)) remaining.find((s) => s.key === (moveTo ?? remaining[0].key))!.is_default = true
  const problem = check(remaining)
  if (problem) return problem

  const target = moveTo ?? defaultStatusKey(remaining)
  const lf = licenseFilter(scope)
  const statements = [env.DB.prepare(`UPDATE licenses SET status = ? WHERE status = ? AND id IN (SELECT l.id FROM licenses l WHERE ${lf.sql})`).bind(target, key, ...lf.args)]
  if ("app" in scope) statements.push(env.DB.prepare("UPDATE apps SET default_status = ? WHERE id = ? AND default_status = ?").bind(target, scope.app, key))
  await env.DB.batch(statements)
  await rewriteFileRules(env, scope, key, moveTo, target)
  await writeScope(env, scope, remaining)
  return { set: remaining }
}

/** Gives a scope its own statuses, starting as a copy of the ones it uses now: the app's or the defaults for a licence, the defaults for an app. */
export async function customizeStatuses(env: Env, scope: StatusScope): Promise<{ set: StatusSet } | Failure> {
  if (await hasCustomSet(env, scope)) return { error: "These statuses are already customised." }
  const copy = (await parentSet(env, scope)).map((s) => ({ ...s }))
  await writeScope(env, scope, copy)
  return { set: copy }
}

/**
 * Removes a scope's own statuses so it uses the next level up again. Licences that use a status the next level lacks
 * need a replacement: `mapping` says which status each such key becomes.
 */
export async function resetStatuses(env: Env, scope: StatusScope, mapping: Record<string, string> = {}): Promise<{ ok: true } | Failure> {
  const own = await loadScope(env, scope)
  if (own.length === 0) return { ok: true }
  const parent = await parentSet(env, scope)
  const target = (key: string): string => (findStatus(parent, key) ? key : (findStatus(parent, mapping[key] ?? "") ? mapping[key] : defaultStatusKey(parent)))

  for (const s of own) {
    if (findStatus(parent, s.key) || (mapping[s.key] && findStatus(parent, mapping[s.key]))) continue
    const usage = await statusUsage(env, scope, s.key)
    if (usage.licenses > 0) return { error: `${usage.licenses} licence${usage.licenses === 1 ? "" : "s"} use "${s.label}", which the next level of statuses does not have. Choose a status to move them to.` }
  }
  const lf = licenseFilter(scope)
  const statements = []
  for (const s of own) {
    const to = target(s.key)
    if (to !== s.key) statements.push(env.DB.prepare(`UPDATE licenses SET status = ? WHERE status = ? AND id IN (SELECT l.id FROM licenses l WHERE ${lf.sql})`).bind(to, s.key, ...lf.args))
  }
  if ("app" in scope) {
    const row = await env.DB.prepare("SELECT default_status FROM apps WHERE id = ?").bind(scope.app).first<{ default_status: string }>()
    if (row && !findStatus(parent, row.default_status)) statements.push(env.DB.prepare("UPDATE apps SET default_status = ? WHERE id = ?").bind(defaultStatusKey(parent), scope.app))
  }
  statements.push(env.DB.prepare(`DELETE FROM statuses WHERE ${scopeColumn(scope)} = ?`).bind(scopeId(scope)))
  await env.DB.batch(statements)

  // File rules that name statuses the next level lacks are cleaned up.
  const ff = fileFilter(scope)
  const rows = (await env.DB.prepare(`SELECT f.id AS id, f.statuses AS statuses FROM files f LEFT JOIN licenses l ON l.id = f.license_id WHERE ${ff.sql}`).bind(...ff.args).all<{ id: string; statuses: string }>()).results
  for (const row of rows) {
    const keys = row.statuses.split(",")
    const kept = keys.filter((k) => findStatus(parent, k))
    if (kept.length !== keys.length) await env.DB.prepare("UPDATE files SET statuses = ? WHERE id = ?").bind((kept.length ? kept : [defaultStatusKey(parent)]).join(","), row.id).run()
  }
  return { ok: true }
}

// ---- reading statuses from JSON and forms -------------------------------------------

const text = (value: unknown, max: number): string | null => (typeof value === "string" ? value.trim().slice(0, max) : null)

/**
 * Reads a status from a JSON body or a form. With `partial`, absent fields stay undefined so an update changes only
 * what was sent. Returns an error message for invalid values.
 */
export function readStatusInput(source: Record<string, unknown>, partial: boolean): { input: Partial<StatusInput> & { label?: string } } | { error: string } {
  const input: Partial<StatusInput> = {}
  if ("label" in source || !partial) {
    const label = text(source.label, 40)
    if (!label) return { error: "A label of 1 to 40 characters is required." }
    input.label = label
  }
  if ("key" in source && !partial) {
    const key = text(source.key, 32)
    if (key) input.key = key.toLowerCase()
  }
  if ("description" in source) {
    const description = text(source.description, 200)
    if (description === null) return { error: "description must be a string." }
    input.description = description
  } else if (!partial) input.description = ""
  if ("color" in source) {
    if (!isColor(source.color)) return { error: "color must be a hex colour such as #16a34a." }
    input.color = source.color.toLowerCase()
  } else if (!partial) input.color = DEFAULT_COLOR
  if ("grants_access" in source) {
    if (typeof source.grants_access !== "boolean") return { error: "grants_access must be true or false." }
    input.grants_access = source.grants_access
  } else if (!partial) input.grants_access = false
  if ("on_expiry" in source) {
    if (source.on_expiry !== null && typeof source.on_expiry !== "string") return { error: "on_expiry must be a status key or null." }
    input.on_expiry = (source.on_expiry as string | null) || null
  } else if (!partial) input.on_expiry = null
  if ("check_message" in source) {
    const message = text(source.check_message, 300)
    if (message === null) return { error: "check_message must be a string." }
    input.check_message = message
  } else if (!partial) input.check_message = ""
  if ("is_default" in source) {
    if (typeof source.is_default !== "boolean") return { error: "is_default must be true or false." }
    input.is_default = source.is_default
  }
  return { input }
}

/** Converts the dashboard's status form into the shape readStatusInput expects. */
export function statusFormToObject(form: FormData): Record<string, unknown> {
  return {
    label: String(form.get("label") ?? ""),
    key: String(form.get("key") ?? ""),
    description: String(form.get("description") ?? ""),
    color: String(form.get("color") ?? DEFAULT_COLOR),
    grants_access: form.get("grants_access") === "on" || form.get("grants_access") === "true",
    on_expiry: String(form.get("on_expiry") ?? "") || null,
    check_message: String(form.get("check_message") ?? ""),
    is_default: form.get("is_default") === "on" || form.get("is_default") === "true",
  }
}

/**
 * Handles the status forms of the dashboard for a scope.
 * Returns `{ ok: true }` on success, `{ error }` on failure, and null when the intent is not a status intent.
 */
export async function applyStatusForm(env: Env, scope: StatusScope, form: FormData): Promise<{ ok: true } | { error: string } | null> {
  const intent = String(form.get("intent") ?? "")
  const key = String(form.get("key") ?? "")
  const result = (r: { error: string } | object): { ok: true } | { error: string } => ("error" in r ? { error: r.error as string } : { ok: true })

  if (intent === "create-status") {
    const parsed = readStatusInput(statusFormToObject(form), false)
    return "error" in parsed ? { error: parsed.error } : result(await createStatus(env, scope, parsed.input as StatusInput))
  }
  if (intent === "update-status") {
    const parsed = readStatusInput(statusFormToObject(form), true)
    return "error" in parsed ? { error: parsed.error } : result(await updateStatus(env, scope, key, parsed.input))
  }
  if (intent === "delete-status") return result(await deleteStatus(env, scope, key, String(form.get("move_to") ?? "") || null))
  if (intent === "move-status") {
    await moveStatus(env, scope, key, form.get("direction") === "up" ? "up" : "down")
    return { ok: true }
  }
  if (intent === "customize-statuses") return result(await customizeStatuses(env, scope))
  if (intent === "reset-statuses") {
    const mapping: Record<string, string> = {}
    for (const [name, value] of form.entries()) if (name.startsWith("map_") && typeof value === "string" && value) mapping[name.slice(4)] = value
    return result(await resetStatuses(env, scope, mapping))
  }
  return null
}
