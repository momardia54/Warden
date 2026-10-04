import {
  DEFAULT_STATUSES, defaultStatusKey, findStatus, isTone, isValidKey, keyFromLabel, validateStatusSet, type StatusDef, type StatusSet, type Tone,
} from "../lib/statuses"

type Row = { app_id: string | null; key: string; label: string; description: string; tone: string; grants_access: number; on_expiry: string | null; check_message: string; is_default: number; position: number }

const toDef = (r: Row): StatusDef => ({
  key: r.key,
  label: r.label,
  description: r.description,
  tone: isTone(r.tone) ? r.tone : "neutral",
  grants_access: r.grants_access === 1,
  on_expiry: r.on_expiry,
  check_message: r.check_message,
  is_default: r.is_default === 1,
  position: r.position,
})

/** Every status set of the installation: the default set, and the custom sets of the apps that have one. */
export type StatusSets = { default: StatusSet; byApp: Record<string, StatusSet> }

export async function loadStatusSets(env: Env): Promise<StatusSets> {
  const rows = (await env.DB.prepare("SELECT * FROM statuses ORDER BY position, id").all<Row>()).results
  const sets: StatusSets = { default: [], byApp: {} }
  for (const row of rows) {
    if (row.app_id === null) sets.default.push(toDef(row))
    else (sets.byApp[row.app_id] ??= []).push(toDef(row))
  }
  // A database without a default set (which should not happen) falls back to the built-in statuses.
  if (sets.default.length === 0) sets.default = DEFAULT_STATUSES
  return sets
}

/** The status set that applies to licences of an app (or to standalone licences when appId is null). */
export function setFor(sets: StatusSets, appId: string | null): StatusSet {
  return (appId && sets.byApp[appId]) || sets.default
}

export async function getStatusSet(env: Env, appId: string | null): Promise<StatusSet> {
  if (appId) {
    const rows = (await env.DB.prepare("SELECT * FROM statuses WHERE app_id = ? ORDER BY position, id").bind(appId).all<Row>()).results
    if (rows.length > 0) return rows.map(toDef)
  }
  const rows = (await env.DB.prepare("SELECT * FROM statuses WHERE app_id IS NULL ORDER BY position, id").all<Row>()).results
  return rows.length > 0 ? rows.map(toDef) : DEFAULT_STATUSES
}

/** The scope of an edit: the default set (null) or the custom set of an app. */
export type Scope = string | null

const scopeWhere = (scope: Scope) => (scope === null ? "app_id IS NULL" : "app_id = ?")
const scopeArgs = (scope: Scope) => (scope === null ? [] : [scope])

/** SQL condition for "licences that use the default set": no app, or an app without its own statuses. */
function defaultSetFilter(column: string, customApps: string[]): { sql: string; args: string[] } {
  return customApps.length ? { sql: `(${column} IS NULL OR ${column} NOT IN (${customApps.map(() => "?").join(",")}))`, args: customApps } : { sql: "1 = 1", args: [] }
}

export async function hasCustomSet(env: Env, appId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 AS found FROM statuses WHERE app_id = ? LIMIT 1").bind(appId).first())
}

export type StatusInput = {
  key?: string
  label: string
  description: string
  tone: Tone
  grants_access: boolean
  on_expiry: string | null
  check_message: string
  is_default?: boolean
}

type Failure = { error: string }

/** Validates a set that is about to replace the stored one. */
function check(set: StatusSet): Failure | null {
  const problem = validateStatusSet(set)
  return problem ? { error: problem } : null
}

async function loadScope(env: Env, scope: Scope): Promise<StatusSet> {
  const rows = (await env.DB.prepare(`SELECT * FROM statuses WHERE ${scopeWhere(scope)} ORDER BY position, id`).bind(...scopeArgs(scope)).all<Row>()).results
  return rows.map(toDef)
}

/** Writes a whole set for a scope, replacing what is stored. The caller has validated it. */
async function writeScope(env: Env, scope: Scope, set: StatusSet): Promise<void> {
  const statements = [env.DB.prepare(`DELETE FROM statuses WHERE ${scopeWhere(scope)}`).bind(...scopeArgs(scope))]
  set.forEach((s, index) => {
    statements.push(
      env.DB.prepare("INSERT INTO statuses (app_id, key, label, description, tone, grants_access, on_expiry, check_message, is_default, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        scope, s.key, s.label, s.description, s.tone, s.grants_access ? 1 : 0, s.on_expiry, s.check_message, s.is_default ? 1 : 0, index + 1
      )
    )
  })
  await env.DB.batch(statements)
}

export async function createStatus(env: Env, scope: Scope, input: StatusInput): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  const key = input.key?.trim() || keyFromLabel(input.label)
  if (!isValidKey(key)) return { error: "The identifier must start with a letter and use lowercase letters, digits and underscores (up to 32). \"unknown\", \"domain_mismatch\" and \"site_limit_reached\" are reserved." }
  if (findStatus(set, key)) return { error: `A status with the identifier "${key}" already exists.` }
  const next = [...set.map((s) => (input.is_default ? { ...s, is_default: false } : s)), { ...input, key, label: input.label.trim(), is_default: input.is_default === true, position: set.length + 1 }]
  const problem = check(next)
  if (problem) return problem
  await writeScope(env, scope, next)
  return { set: next }
}

export async function updateStatus(env: Env, scope: Scope, key: string, changes: Partial<StatusInput>): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  const current = findStatus(set, key)
  if (!current) return { error: "Status not found." }
  const next = set.map((s) => {
    if (s.key !== key) return changes.is_default ? { ...s, is_default: false } : s
    return {
      ...s,
      label: changes.label !== undefined ? changes.label.trim() : s.label,
      description: changes.description ?? s.description,
      tone: changes.tone ?? s.tone,
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
export async function moveStatus(env: Env, scope: Scope, key: string, direction: "up" | "down"): Promise<void> {
  const set = await loadScope(env, scope)
  const index = set.findIndex((s) => s.key === key)
  const target = direction === "up" ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= set.length) return
  ;[set[index], set[target]] = [set[target], set[index]]
  await writeScope(env, scope, set)
}

/** Counts the licences and files that use a status, within the scope the status belongs to. */
export async function statusUsage(env: Env, scope: Scope, key: string): Promise<{ licenses: number; files: number }> {
  const sets = await loadStatusSets(env)
  const customApps = Object.keys(sets.byApp)
  const licenseScope = scope === null ? defaultSetFilter("l.app_id", customApps) : { sql: "l.app_id = ?", args: [scope] }
  const licenses = await env.DB.prepare(`SELECT COUNT(*) AS c FROM licenses l WHERE l.status = ? AND ${licenseScope.sql}`).bind(key, ...licenseScope.args).first<{ c: number }>()
  const fileScope = scope === null ? defaultSetFilter("COALESCE(f.app_id, l.app_id)", customApps) : { sql: "COALESCE(f.app_id, l.app_id) = ?", args: [scope] }
  const files = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM files f LEFT JOIN licenses l ON l.id = f.license_id WHERE (',' || f.statuses || ',') LIKE ? AND ${fileScope.sql}`
  ).bind(`%,${key},%`, ...fileScope.args).first<{ c: number }>()
  return { licenses: licenses?.c ?? 0, files: files?.c ?? 0 }
}

/**
 * Deletes a status. Licences that use it move to `moveTo` (required when any licence uses it); file release rules
 * and the app default that refer to it are updated to match.
 */
export async function deleteStatus(env: Env, scope: Scope, key: string, moveTo: string | null): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  const status = findStatus(set, key)
  if (!status) return { error: "Status not found." }
  if (set.length === 1) return { error: "A set needs at least one status." }
  const usage = await statusUsage(env, scope, key)
  if (usage.licenses > 0 && !moveTo) return { error: `${usage.licenses} licence${usage.licenses === 1 ? "" : "s"} use this status. Choose a status to move them to.` }
  if (moveTo !== null && (moveTo === key || !findStatus(set, moveTo))) return { error: "Choose a different status of the same set to move licences to." }

  const remaining = set.filter((s) => s.key !== key).map((s) => ({ ...s, on_expiry: s.on_expiry === key ? null : s.on_expiry }))
  if (!remaining.some((s) => s.is_default)) remaining.find((s) => s.key === (moveTo ?? remaining[0].key))!.is_default = true
  const problem = check(remaining)
  if (problem) return problem

  const target = moveTo ?? defaultStatusKey(remaining)
  const sets = await loadStatusSets(env)
  const customApps = Object.keys(sets.byApp)
  const statements = []
  // Licences.
  if (scope === null) {
    const licenseScope = defaultSetFilter("app_id", customApps)
    statements.push(env.DB.prepare(`UPDATE licenses SET status = ? WHERE status = ? AND ${licenseScope.sql}`).bind(target, key, ...licenseScope.args))
  } else {
    statements.push(env.DB.prepare("UPDATE licenses SET status = ? WHERE status = ? AND app_id = ?").bind(target, key, scope))
    statements.push(env.DB.prepare("UPDATE apps SET default_status = ? WHERE id = ? AND default_status = ?").bind(target, scope, key))
  }
  if (scope === null) {
    statements.push(env.DB.prepare(`UPDATE apps SET default_status = ? WHERE default_status = ?${customApps.length ? ` AND id NOT IN (${customApps.map(() => "?").join(",")})` : ""}`).bind(target, key, ...customApps))
  }
  await env.DB.batch(statements)
  await rewriteFileRules(env, scope, customApps, key, moveTo, target)
  await writeScope(env, scope, remaining)
  return { set: remaining }
}

/** Replaces a deleted status key in the release rules of the files of a scope. A rule left empty gets the set's default status. */
async function rewriteFileRules(env: Env, scope: Scope, customApps: string[], key: string, moveTo: string | null, target: string): Promise<void> {
  const rows = (
    await env.DB.prepare("SELECT f.id AS id, f.statuses AS statuses, COALESCE(f.app_id, l.app_id) AS owner_app FROM files f LEFT JOIN licenses l ON l.id = f.license_id WHERE (',' || f.statuses || ',') LIKE ?")
      .bind(`%,${key},%`)
      .all<{ id: string; statuses: string; owner_app: string | null }>()
  ).results
  for (const row of rows) {
    const inScope = scope === null ? row.owner_app === null || !customApps.includes(row.owner_app) : row.owner_app === scope
    if (!inScope) continue
    const keys = row.statuses.split(",").filter((k) => k !== key)
    if (moveTo && !keys.includes(moveTo)) keys.push(moveTo)
    if (keys.length === 0) keys.push(target)
    await env.DB.prepare("UPDATE files SET statuses = ? WHERE id = ?").bind(keys.join(","), row.id).run()
  }
}

/** Gives an app its own set of statuses, starting as a copy of the default set. */
export async function customizeAppStatuses(env: Env, appId: string): Promise<{ set: StatusSet } | Failure> {
  if (await hasCustomSet(env, appId)) return { error: "This app already has its own statuses." }
  const copy = (await loadScope(env, null)).map((s) => ({ ...s }))
  await writeScope(env, appId, copy)
  return { set: copy }
}

/**
 * Removes an app's own set so it uses the default set again. Licences and files that use a status the default set does not
 * have must be moved first: `mapping` says which default status each custom key becomes.
 */
export async function resetAppStatuses(env: Env, appId: string, mapping: Record<string, string> = {}): Promise<{ ok: true } | Failure> {
  const defaults = await loadScope(env, null)
  const custom = await loadScope(env, appId)
  if (custom.length === 0) return { ok: true }
  const unmapped = custom.filter((s) => !findStatus(defaults, s.key) && !(mapping[s.key] && findStatus(defaults, mapping[s.key])))
  for (const s of unmapped) {
    const usage = await statusUsage(env, appId, s.key)
    if (usage.licenses > 0) return { error: `${usage.licenses} licence${usage.licenses === 1 ? "" : "s"} use "${s.label}", which the default statuses do not have. Move them to another status first.` }
  }
  const statements = []
  for (const s of custom) {
    const to = findStatus(defaults, s.key) ? s.key : (mapping[s.key] ?? defaultStatusKey(defaults))
    if (to !== s.key) statements.push(env.DB.prepare("UPDATE licenses SET status = ? WHERE status = ? AND app_id = ?").bind(to, s.key, appId))
  }
  const appRow = await env.DB.prepare("SELECT default_status FROM apps WHERE id = ?").bind(appId).first<{ default_status: string }>()
  if (appRow && !findStatus(defaults, appRow.default_status)) statements.push(env.DB.prepare("UPDATE apps SET default_status = ? WHERE id = ?").bind(defaultStatusKey(defaults), appId))
  statements.push(env.DB.prepare("DELETE FROM statuses WHERE app_id = ?").bind(appId))
  await env.DB.batch(statements)
  // File rules that name statuses the default set lacks are cleaned up.
  const rows = (await env.DB.prepare("SELECT f.id AS id, f.statuses AS statuses FROM files f LEFT JOIN licenses l ON l.id = f.license_id WHERE COALESCE(f.app_id, l.app_id) = ?").bind(appId).all<{ id: string; statuses: string }>()).results
  for (const row of rows) {
    const keys = row.statuses.split(",").filter((k) => findStatus(defaults, k))
    if (keys.length !== row.statuses.split(",").length) {
      await env.DB.prepare("UPDATE files SET statuses = ? WHERE id = ?").bind((keys.length ? keys : [defaultStatusKey(defaults)]).join(","), row.id).run()
    }
  }
  return { ok: true }
}

/** Applies a new order. `keys` must list every status of the set exactly once. */
export async function setStatusOrder(env: Env, scope: Scope, keys: string[]): Promise<{ set: StatusSet } | Failure> {
  const set = await loadScope(env, scope)
  if (keys.length !== set.length || new Set(keys).size !== keys.length || !keys.every((k) => findStatus(set, k))) {
    return { error: "keys must list every status of the set exactly once." }
  }
  const next = keys.map((k) => findStatus(set, k)!)
  await writeScope(env, scope, next)
  return { set: next }
}

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
  if ("tone" in source) {
    if (!isTone(source.tone)) return { error: "tone must be one of: success, warning, danger, info, neutral." }
    input.tone = source.tone
  } else if (!partial) input.tone = "neutral"
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
    tone: String(form.get("tone") ?? "neutral"),
    grants_access: form.get("grants_access") === "on" || form.get("grants_access") === "true",
    on_expiry: String(form.get("on_expiry") ?? "") || null,
    check_message: String(form.get("check_message") ?? ""),
    is_default: form.get("is_default") === "on" || form.get("is_default") === "true",
  }
}

/**
 * Handles the status forms of the dashboard for a scope (the default set, or an app's own set).
 * Returns `{ ok: true }` on success, `{ error }` on failure, and null when the intent is not a status intent.
 */
export async function applyStatusForm(env: Env, scope: Scope, form: FormData): Promise<{ ok: true } | { error: string } | null> {
  const intent = String(form.get("intent") ?? "")
  const key = String(form.get("key") ?? "")
  const failure = (result: { error: string } | object): { ok: true } | { error: string } => ("error" in result ? { error: result.error as string } : { ok: true })

  if (intent === "create-status") {
    if (scope !== null && !(await hasCustomSet(env, scope))) return { error: "This app uses the default statuses. Customise them first." }
    const parsed = readStatusInput(statusFormToObject(form), false)
    return "error" in parsed ? { error: parsed.error } : failure(await createStatus(env, scope, parsed.input as StatusInput))
  }
  if (intent === "update-status") {
    const parsed = readStatusInput(statusFormToObject(form), true)
    return "error" in parsed ? { error: parsed.error } : failure(await updateStatus(env, scope, key, parsed.input))
  }
  if (intent === "delete-status") return failure(await deleteStatus(env, scope, key, String(form.get("move_to") ?? "") || null))
  if (intent === "move-status") {
    await moveStatus(env, scope, key, form.get("direction") === "up" ? "up" : "down")
    return { ok: true }
  }
  if (intent === "customize-statuses" && scope !== null) return failure(await customizeAppStatuses(env, scope))
  if (intent === "reset-statuses" && scope !== null) {
    const mapping: Record<string, string> = {}
    for (const [name, value] of form.entries()) if (name.startsWith("map_") && typeof value === "string" && value) mapping[name.slice(4)] = value
    return failure(await resetAppStatuses(env, scope, mapping))
  }
  return null
}

/** Number of licences per stored status within a scope (the default set, or an app's own set). */
export async function statusCounts(env: Env, scope: Scope): Promise<Record<string, number>> {
  const sets = await loadStatusSets(env)
  const customApps = Object.keys(sets.byApp)
  const filter = scope === null ? defaultSetFilter("app_id", customApps) : { sql: "app_id = ?", args: [scope] }
  const rows = (await env.DB.prepare(`SELECT status, COUNT(*) AS c FROM licenses WHERE ${filter.sql} GROUP BY status`).bind(...filter.args).all<{ status: string; c: number }>()).results
  return Object.fromEntries(rows.map((r) => [r.status, r.c]))
}
