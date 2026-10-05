import { isValidSlug, latestVersioned, slugify } from "../lib/apps"
import { defaultStatusKey, effectiveStatusKey, findStatus, type StatusSet } from "../lib/statuses"
import { deleteAppFiles } from "./files.server"
import { parseOptionalCount, type LicenseInput } from "./licenses.server"
import { loadStatusSets, setForApp } from "./statuses.server"
import { newId } from "./util.server"

export type App = {
  id: string
  name: string
  slug: string
  description: string
  default_duration_days: number | null
  /** Key of the status new licences of this app start with, within the app's status set. */
  default_status: string
  default_max_sites: number | null
  default_message: string
  notes: string
  created_at: number
  updated_at: number
}

export type AppInput = Omit<App, "id" | "created_at" | "updated_at">

export type AppSummary = App & {
  licenses: number
  /** Licences that are currently valid for sites: completed, or active and not expired. */
  in_force: number
  /** Total number of site activations across the app's licences. */
  sites: number
  files: number
  latest_version: string | null
}

export const MAX_DURATION_DAYS = 3650

/** Validates the dashboard form and returns the cleaned input, or an error message. `statuses` is the status set the app uses. */
export function readAppForm(form: FormData, statuses: StatusSet): { input: AppInput } | { error: string } {
  const name = String(form.get("name") ?? "").trim()
  if (!name) return { error: "Enter a name for the app." }
  if (name.length > 80) return { error: "The name must be 80 characters or fewer." }
  const slug = String(form.get("slug") ?? "").trim().toLowerCase() || slugify(name)
  if (!isValidSlug(slug)) return { error: "The identifier must be 2 to 48 characters: lowercase letters, digits and single hyphens." }
  const status = String(form.get("default_status") ?? defaultStatusKey(statuses))
  if (!findStatus(statuses, status)) return { error: "Choose a valid default status." }
  const duration = parseOptionalCount(form.get("default_duration_days"), MAX_DURATION_DAYS)
  if (duration === "invalid") return { error: `Default duration must be a whole number of days from 1 to ${MAX_DURATION_DAYS}, or empty for no expiry.` }
  const maxSites = parseOptionalCount(form.get("default_max_sites"))
  if (maxSites === "invalid") return { error: "Default maximum sites must be a whole number of 1 or more, or empty for unlimited." }
  return {
    input: {
      name,
      slug,
      description: String(form.get("description") ?? "").trim().slice(0, 500),
      default_duration_days: duration,
      default_status: status,
      default_max_sites: maxSites,
      default_message: String(form.get("default_message") ?? "").trim().slice(0, 300),
      notes: String(form.get("notes") ?? "").trim().slice(0, 4000),
    },
  }
}

export function getApp(env: Env, id: string): Promise<App | null> {
  return env.DB.prepare("SELECT * FROM apps WHERE id = ?").bind(id).first<App>()
}

/** Finds an app by its id (app_...) or its slug. */
export function findApp(env: Env, idOrSlug: string): Promise<App | null> {
  return env.DB.prepare("SELECT * FROM apps WHERE id = ? OR slug = ?").bind(idOrSlug, idOrSlug).first<App>()
}

export async function createApp(env: Env, input: AppInput): Promise<{ app: App } | { error: string }> {
  if (await env.DB.prepare("SELECT 1 AS taken FROM apps WHERE slug = ?").bind(input.slug).first()) return { error: "Another app already uses this identifier." }
  const id = newId("app")
  const now = Date.now()
  try {
    await env.DB.prepare(
      `INSERT INTO apps (id, name, slug, description, default_duration_days, default_status, default_max_sites, default_message, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.name, input.slug, input.description, input.default_duration_days, input.default_status, input.default_max_sites, input.default_message, input.notes, now, now).run()
  } catch (error) {
    // Another request created an app with the same identifier between the check above and this insert.
    if (/UNIQUE/i.test(String(error instanceof Error ? error.message : error))) return { error: "Another app already uses this identifier." }
    throw error
  }
  return { app: (await getApp(env, id))! }
}

export async function updateApp(env: Env, app: App, input: AppInput): Promise<{ app: App } | { error: string }> {
  if (input.slug !== app.slug && (await env.DB.prepare("SELECT 1 AS taken FROM apps WHERE slug = ? AND id != ?").bind(input.slug, app.id).first())) {
    return { error: "Another app already uses this identifier." }
  }
  await env.DB.prepare(
    `UPDATE apps SET name = ?, slug = ?, description = ?, default_duration_days = ?, default_status = ?, default_max_sites = ?, default_message = ?, notes = ?, updated_at = ? WHERE id = ?`
  ).bind(input.name, input.slug, input.description, input.default_duration_days, input.default_status, input.default_max_sites, input.default_message, input.notes, Date.now(), app.id).run()
  return { app: (await getApp(env, app.id))! }
}

/** Deletes an app and its files. Refused while the app still has licences, so no licence loses its app by accident. */
export async function deleteApp(env: Env, app: App): Promise<{ ok: true } | { error: string }> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM licenses WHERE app_id = ?").bind(app.id).first<{ c: number }>()
  if ((count?.c ?? 0) > 0) return { error: `This app still has ${count!.c} licence${count!.c === 1 ? "" : "s"}. Delete them or move them to another app first.` }
  await deleteAppFiles(env, app.id)
  await env.DB.batch([env.DB.prepare("DELETE FROM files WHERE app_id = ?").bind(app.id), env.DB.prepare("DELETE FROM statuses WHERE app_id = ?").bind(app.id), env.DB.prepare("DELETE FROM apps WHERE id = ?").bind(app.id)])
  return { ok: true }
}

export async function listApps(env: Env, now = Date.now()): Promise<AppSummary[]> {
  const apps = (
    await env.DB.prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM licenses l WHERE l.app_id = a.id) AS licenses,
        (SELECT COUNT(*) FROM activations x JOIN licenses l ON l.id = x.license_id WHERE l.app_id = a.id) AS sites,
        (SELECT COUNT(*) FROM files f WHERE f.app_id = a.id) AS files
       FROM apps a ORDER BY a.name COLLATE NOCASE`
    ).all<Omit<AppSummary, "latest_version" | "in_force">>()
  ).results
  const versions = (await env.DB.prepare("SELECT app_id, version FROM files WHERE app_id IS NOT NULL AND version != ''").all<{ app_id: string; version: string }>()).results
  const sets = await loadStatusSets(env)
  const licenses = (await env.DB.prepare("SELECT app_id, status, expires_at FROM licenses WHERE app_id IS NOT NULL").all<{ app_id: string; status: string; expires_at: number | null }>()).results
  return apps.map((app) => {
    const set = setForApp(sets, app.id)
    const inForce = licenses.filter((l) => l.app_id === app.id && findStatus(set, effectiveStatusKey(l, set, now))?.grants_access).length
    return { ...app, in_force: inForce, latest_version: latestVersioned(versions.filter((v) => v.app_id === app.id))?.version ?? null }
  })
}

export async function getAppSummary(env: Env, idOrSlug: string): Promise<AppSummary | null> {
  const app = await findApp(env, idOrSlug)
  return app ? ((await listApps(env)).find((a) => a.id === app.id) ?? null) : null
}

/** The licence values a new licence of this app starts with. Explicit input overrides them. */
export function appDefaults(app: App, now = Date.now()): Pick<LicenseInput, "status" | "expires_at" | "max_sites" | "message"> {
  return {
    status: app.default_status,
    expires_at: app.default_duration_days ? now + app.default_duration_days * 86_400_000 : null,
    max_sites: app.default_max_sites,
    message: app.default_message,
  }
}
