import { KEY_PATTERN } from "../lib/license"
import { DEFAULT_STATUSES, defaultStatusKey, findStatus, type StatusSet } from "../lib/statuses"
import { applyAppBody, applyLicenseBody } from "./api-input.server"
import { authenticate, type ApiKeyRow } from "./api-keys.server"
import { CORS, fail, parseExpiry, readJson, reply, requirePermission, trimmed } from "./api-http.server"
import { serializeActivation, serializeActivity, serializeApp, serializeFile, serializeLicense, serializeStatus } from "./api-serializers.server"
import { appDefaults, createApp, deleteApp, findApp, getAppSummary, listApps, updateApp, type App, type AppInput } from "./apps.server"
import { deleteFile, getFile, listFiles, statusSetForOwner, storeFile, updateFile, type FileOwner } from "./files.server"
import {
  createLicense, deleteLicense, extendLicense, getLicense, getLicenseByKey, getLicenseByRef, listActivations, overviewStats, queryLicenses, recentActivity,
  regenerateKey, releaseActivation, renewUntil, setStatus, updateLicense, type License, type LicenseInput,
} from "./licenses.server"
import { openApiSpec } from "./openapi.server"
import {
  createStatus, customizeStatuses, deleteStatus, getStatusSetForApp, getStatusSetForLicense, hasCustomSet, loadStatusSets, readStatusInput, resetStatuses, setForLicense,
  setStatusOrder, statusSource, updateStatus, type StatusInput, type StatusScope,
} from "./statuses.server"

type Context = { env: Env; request: Request; url: URL; origin: string; key: ApiKeyRow }

const need = (ctx: Context, scope: "read" | "manage" | "full") => requirePermission(ctx.key.scope, scope)

const LICENSE_DEFAULTS: Omit<LicenseInput, "status"> = {
  name: "", customer_name: "", customer_email: "", app_id: null, max_sites: null, expires_at: null, domains: "", message: "", notes: "",
}

const APP_DEFAULTS: AppInput = {
  name: "", slug: "", description: "", default_duration_days: null, default_status: "", default_max_sites: null, default_message: "", notes: "",
}

const toInput = (l: License): LicenseInput => ({
  name: l.name, customer_name: l.customer_name, customer_email: l.customer_email, app_id: l.app_id, max_sites: l.max_sites, status: l.status,
  expires_at: l.expires_at, domains: l.domains, message: l.message, notes: l.notes,
})

const toAppInput = (a: App): AppInput => ({
  name: a.name, slug: a.slug, description: a.description, default_duration_days: a.default_duration_days, default_status: a.default_status,
  default_max_sites: a.default_max_sites, default_message: a.default_message, notes: a.notes,
})

/** Finds a licence by its id (lic_...) or its licence key (WRD-...). */
async function findLicense(env: Env, idOrKey: string): Promise<License | null> {
  const upper = idOrKey.toUpperCase()
  if (KEY_PATTERN.test(upper)) return getLicenseByKey(env, upper)
  return /^lic_[a-z0-9]+$/.test(idOrKey) ? getLicense(env, idOrKey) : null
}

/** Resolves the `app` field of a request body: undefined (absent), null (no app) or an app. */
async function resolveAppField(env: Env, body: Record<string, unknown>): Promise<App | null | undefined | Response> {
  if (!("app" in body)) return undefined
  if (body.app === null) return null
  const ref = trimmed(body.app, 60)
  if (!ref) return fail(422, "invalid_app", "app must be an app id, an app slug or null.")
  return (await findApp(env, ref)) ?? fail(422, "invalid_app", `No app matches "${ref}".`)
}

// ---- licences ---------------------------------------------------------------------

async function listLicensesResponse(ctx: Context, appId?: string): Promise<Response> {
  const q = ctx.url.searchParams
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 25))
  const sets = await loadStatusSets(ctx.env)
  const status = q.get("status") ?? undefined
  if (status && ![DEFAULT_STATUSES, ...Object.values(sets.byApp), ...Object.values(sets.byLicense)].some((set) => findStatus(set, status))) {
    return fail(422, "invalid_status", `status must be one of: ${DEFAULT_STATUSES.map((s) => s.key).join(", ")}, or a status that an app or licence has defined.`)
  }
  let filterApp = appId
  const appRef = q.get("app")
  if (!filterApp && appRef) {
    const app = await findApp(ctx.env, appRef)
    if (!app) return fail(422, "invalid_app", `No app matches "${appRef}".`)
    filterApp = app.id
  }
  const rows = await queryLicenses(ctx.env, { status, q: q.get("q") ?? undefined, externalRef: q.get("external_ref") ?? undefined, appId: filterApp, before: q.get("before") ?? undefined, limit: limit + 1 })
  const page = rows.slice(0, limit)
  return reply({ data: page.map((l) => serializeLicense(l, ctx.origin, setForLicense(sets, l))), next: rows.length > limit ? page[page.length - 1].id : null })
}

/** Creates a licence from a JSON body. Under an app, the app's defaults apply to every field the body leaves out. */
async function createLicenseResponse(ctx: Context, forcedApp?: App): Promise<Response> {
  const denied = need(ctx, "manage")
  if (denied) return denied
  const body = await readJson(ctx.request)
  if (body instanceof Response) return body

  const ref = body.external_ref === undefined || body.external_ref === null ? null : trimmed(body.external_ref, 120)
  if (body.external_ref !== undefined && body.external_ref !== null && !ref) return fail(422, "invalid_external_ref", "external_ref must be a non-empty string of at most 120 characters.")
  if (ref) {
    const existing = await getLicenseByRef(ctx.env, ref)
    if (existing) return reply(serializeLicense(existing, ctx.origin, await getStatusSetForLicense(ctx.env, existing)), 200, { "idempotent-replayed": "true" })
  }
  if (!("name" in body)) return fail(422, "invalid_name", "name is required.")

  const fromBody = forcedApp === undefined ? await resolveAppField(ctx.env, body) : forcedApp
  if (fromBody instanceof Response) return fromBody
  const app = fromBody ?? null
  const set = await getStatusSetForApp(ctx.env, app?.id ?? null)
  const base: LicenseInput = { ...LICENSE_DEFAULTS, status: defaultStatusKey(set), ...(app ? appDefaults(app) : {}), app_id: app?.id ?? null }
  const parsed = applyLicenseBody(body, base, set)
  if ("response" in parsed) return parsed.response
  try {
    return reply(serializeLicense(await createLicense(ctx.env, { ...parsed.input, external_ref: ref }), ctx.origin, set), 201)
  } catch (error) {
    // Two requests with the same reference can race; the unique index lets one succeed and the other returns that licence.
    const existing = ref ? await getLicenseByRef(ctx.env, ref) : null
    if (existing) return reply(serializeLicense(existing, ctx.origin, set), 200, { "idempotent-replayed": "true" })
    throw error
  }
}

async function licenseRoute(ctx: Context, segments: string[]): Promise<Response> {
  const { env, request, origin } = ctx
  const method = request.method
  if (segments.length === 0) {
    if (method === "GET") return listLicensesResponse(ctx)
    if (method === "POST") return createLicenseResponse(ctx)
    return fail(405, "method_not_allowed", "Use GET or POST.")
  }

  const license = await findLicense(env, segments[0])
  if (!license) return fail(404, "license_not_found", "No licence matches that id or key.")
  const set = await getStatusSetForLicense(env, license)
  const [, sub, ...rest] = segments
  const extra = rest[0]

  if (!sub) {
    if (method === "GET") return reply(serializeLicense(license, origin, set))
    if (method === "PATCH") {
      const denied = need(ctx, "manage")
      if (denied) return denied
      const body = await readJson(request)
      if (body instanceof Response) return body
      const app = await resolveAppField(env, body)
      if (app instanceof Response) return app
      const targetApp = app === undefined ? license.app_id : (app?.id ?? null)
      const targetSet = targetApp === license.app_id ? set : await getStatusSetForLicense(env, { id: license.id, app_id: targetApp })
      const base = { ...toInput(license), app_id: targetApp }
      // Moving to an app whose statuses lack the licence's current status: the licence takes that set's default unless a status is sent.
      if (!findStatus(targetSet, base.status) && !("status" in body)) base.status = defaultStatusKey(targetSet)
      const parsed = applyLicenseBody(body, base, targetSet)
      if ("response" in parsed) return parsed.response
      await updateLicense(env, license, parsed.input)
      return reply(serializeLicense((await getLicense(env, license.id))!, origin, targetSet))
    }
    if (method === "DELETE") {
      const denied = need(ctx, "full")
      if (denied) return denied
      await deleteLicense(env, license.id)
      return reply({ deleted: true, id: license.id })
    }
    return fail(405, "method_not_allowed", "Use GET, PATCH or DELETE.")
  }

  if (sub === "files") return filesRoute(ctx, { license }, extra)
  if (sub === "statuses") return statusRoute(ctx, { license: license.id }, set, rest)

  if (sub === "activity") {
    if (method !== "GET") return fail(405, "method_not_allowed", "Use GET.")
    const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get("limit")) || 50))
    return reply({ data: (await recentActivity(env, license.id, limit)).map(serializeActivity) })
  }

  if (sub === "activations") {
    if (method === "GET" && !extra) return reply({ max_sites: license.max_sites, data: (await listActivations(env, license.id)).map(serializeActivation) })
    if (method === "DELETE" && extra) {
      const denied = need(ctx, "manage")
      if (denied) return denied
      return (await releaseActivation(env, license, decodeURIComponent(extra).toLowerCase())) ? reply({ released: true, domain: extra }) : fail(404, "activation_not_found", "That domain is not registered for this licence.")
    }
    return fail(405, "method_not_allowed", "Use GET on /activations, and DELETE on /activations/{domain}.")
  }

  if ((sub === "status" || sub === "renew" || sub === "regenerate-key") && !extra) {
    if (method !== "POST") return fail(405, "method_not_allowed", "Use POST.")
    const denied = need(ctx, sub === "regenerate-key" ? "full" : "manage")
    if (denied) return denied
    const body = await readJson(request)
    if (body instanceof Response) return body

    if (sub === "status") {
      if (typeof body.status !== "string" || !findStatus(set, body.status)) return fail(422, "invalid_status", `status must be one of: ${set.map((s) => s.key).join(", ")}.`)
      await setStatus(env, license, body.status)
    } else if (sub === "renew") {
      if ("until" in body) {
        const until = parseExpiry(body.until)
        if (until === "invalid" || until === null || until <= Date.now()) return fail(422, "invalid_until", "until must be a date (YYYY-MM-DD) or an ISO date-time in the future.")
        await renewUntil(env, license, until)
      } else {
        const days = Number(body.days)
        if (!Number.isInteger(days) || days < 1 || days > 3650) return fail(422, "invalid_days", "Send days (1 to 3650) or until (a date).")
        await extendLicense(env, license, days)
      }
    } else {
      await regenerateKey(env, license)
    }
    return reply(serializeLicense((await getLicense(env, license.id))!, origin, set))
  }
  return fail(404, "not_found", "Unknown endpoint. See /api/v1/openapi.json.")
}

// ---- files ------------------------------------------------------------------------

/** Files of a licence or of an app. Both use the same endpoints and release rules. */
async function filesRoute(ctx: Context, owner: FileOwner, fileId: string | undefined): Promise<Response> {
  const { env, request, url, origin } = ctx
  const method = request.method
  const license = "license" in owner ? owner.license : null
  const set = await statusSetForOwner(env, owner)
  const shape = (f: Parameters<typeof serializeFile>[0]) => serializeFile(f, license, origin, set)

  if (method === "GET" && !fileId) return reply({ data: (await listFiles(env, owner)).map(shape) })

  if (method === "PUT" && !fileId) {
    const denied = need(ctx, "manage")
    if (denied) return denied
    const q = url.searchParams
    const stored = await storeFile(env, owner, {
      name: q.get("name") ?? "",
      statuses: q.get("statuses") ?? undefined,
      checkDomain: q.get("check_domain") !== "false",
      version: q.get("version") ?? "",
      notes: q.get("notes") ?? "",
      contentType: request.headers.get("content-type"),
      size: Number(request.headers.get("content-length")),
      body: request.body,
    })
    return "error" in stored ? fail(stored.status, "upload_failed", stored.error) : reply(shape(stored.file), 201)
  }

  if (fileId && (method === "PATCH" || method === "DELETE")) {
    const denied = need(ctx, "manage")
    if (denied) return denied
    const file = await getFile(env, owner, fileId)
    if (!file) return fail(404, "file_not_found", "File not found.")
    if (method === "DELETE") {
      await deleteFile(env, owner, file)
      return reply({ deleted: true, id: file.id })
    }
    const body = await readJson(request)
    if (body instanceof Response) return body
    const updated = await updateFile(env, owner, file, {
      statuses: body.statuses,
      checkDomain: typeof body.check_domain === "boolean" ? body.check_domain : undefined,
      version: typeof body.version === "string" ? body.version : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    })
    return "error" in updated ? fail(updated.status, "invalid_file", updated.error) : reply(shape(updated.file))
  }
  return fail(405, "method_not_allowed", "Use GET or PUT on /files, and PATCH or DELETE on /files/{fileId}.")
}

// ---- statuses ---------------------------------------------------------------------

/**
 * The statuses of an app or of a licence. A licence uses its own statuses if it has customised them, otherwise its
 * app's, otherwise the built-in defaults. `current` is the set in effect for the scope. Paths relative to .../statuses:
 *   GET /  POST /  DELETE /  POST /customize  POST /order  PATCH /{key}  DELETE /{key}?move_to=
 */
async function statusRoute(ctx: Context, scope: StatusScope, current: StatusSet, segments: string[]): Promise<Response> {
  const { env, request, url } = ctx
  const method = request.method
  const custom = await hasCustomSet(env, scope)
  const list = (set: StatusSet) => reply({ data: set.map(serializeStatus) })

  if (segments.length === 0) {
    if (method === "GET") {
      const source = "license" in scope ? await statusSource(env, { id: scope.license, app_id: await appOfLicense(env, scope.license) }) : custom ? "app" : "default"
      return reply({ custom, source, data: current.map(serializeStatus) })
    }
    if (method === "POST") {
      const denied = need(ctx, "manage")
      if (denied) return denied
      if (!custom) return fail(409, "statuses_not_customized", "These statuses are not customised yet. Call POST .../statuses/customize first.")
      const body = await readJson(request)
      if (body instanceof Response) return body
      const parsed = readStatusInput(body, false)
      if ("error" in parsed) return fail(422, "invalid_status", parsed.error)
      const created = await createStatus(env, scope, parsed.input as StatusInput)
      return "error" in created ? fail(422, "invalid_status", created.error) : reply(serializeStatus(created.set.find((s) => s.key === (parsed.input.key || created.set[created.set.length - 1].key))!), 201)
    }
    if (method === "DELETE") {
      const denied = need(ctx, "full")
      if (denied) return denied
      const body = await readJson(request)
      if (body instanceof Response) return body
      const mapping = body.mapping && typeof body.mapping === "object" ? (body.mapping as Record<string, string>) : {}
      const reset = await resetStatuses(env, scope, mapping)
      return "error" in reset ? fail(409, "statuses_in_use", reset.error) : reply({ custom: false, data: (await currentSet(env, scope)).map(serializeStatus) })
    }
    return fail(405, "method_not_allowed", "Use GET, POST or DELETE.")
  }

  const [first] = segments
  if (first === "customize" && method === "POST") {
    const denied = need(ctx, "manage")
    if (denied) return denied
    const result = await customizeStatuses(env, scope)
    return "error" in result ? fail(409, "already_customized", result.error) : reply({ custom: true, data: result.set.map(serializeStatus) }, 201)
  }
  if (first === "order" && method === "POST") {
    const denied = need(ctx, "manage")
    if (denied) return denied
    const body = await readJson(request)
    if (body instanceof Response) return body
    if (!Array.isArray(body.keys) || !body.keys.every((k) => typeof k === "string")) return fail(422, "invalid_keys", "keys must be an array of status keys.")
    const ordered = await setStatusOrder(env, scope, body.keys as string[])
    return "error" in ordered ? fail(422, "invalid_keys", ordered.error) : list(ordered.set)
  }

  if (!findStatus(current, first)) return fail(404, "status_not_found", "No status with that key.")
  if (!custom) return fail(409, "statuses_not_customized", "These statuses are not customised yet. Call POST .../statuses/customize first.")
  if (method === "PATCH") {
    const denied = need(ctx, "manage")
    if (denied) return denied
    const body = await readJson(request)
    if (body instanceof Response) return body
    const parsed = readStatusInput(body, true)
    if ("error" in parsed) return fail(422, "invalid_status", parsed.error)
    const updated = await updateStatus(env, scope, first, parsed.input)
    return "error" in updated ? fail(422, "invalid_status", updated.error) : reply(serializeStatus(updated.set.find((s) => s.key === first)!))
  }
  if (method === "DELETE") {
    const denied = need(ctx, "full")
    if (denied) return denied
    const deleted = await deleteStatus(env, scope, first, url.searchParams.get("move_to"))
    return "error" in deleted ? fail(409, "status_in_use", deleted.error) : list(deleted.set)
  }
  return fail(405, "method_not_allowed", "Use PATCH or DELETE.")
}

async function appOfLicense(env: Env, licenseId: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT app_id FROM licenses WHERE id = ?").bind(licenseId).first<{ app_id: string | null }>())?.app_id ?? null
}

/** The statuses in effect for a scope. */
async function currentSet(env: Env, scope: StatusScope): Promise<StatusSet> {
  return "app" in scope ? getStatusSetForApp(env, scope.app) : getStatusSetForLicense(env, { id: scope.license, app_id: await appOfLicense(env, scope.license) })
}

// ---- apps -------------------------------------------------------------------------

async function appRoute(ctx: Context, segments: string[]): Promise<Response> {
  const { env, request, origin } = ctx
  const method = request.method

  if (segments.length === 0) {
    if (method === "GET") return reply({ data: (await listApps(env)).map(serializeApp) })
    if (method === "POST") {
      const denied = need(ctx, "manage")
      if (denied) return denied
      const body = await readJson(request)
      if (body instanceof Response) return body
      if (!("name" in body)) return fail(422, "invalid_name", "name is required.")
      const parsed = applyAppBody(body, { ...APP_DEFAULTS, default_status: defaultStatusKey(DEFAULT_STATUSES) }, DEFAULT_STATUSES)
      if ("response" in parsed) return parsed.response
      const created = await createApp(env, parsed.input)
      return "error" in created ? fail(409, "slug_taken", created.error) : reply(serializeApp((await getAppSummary(env, created.app.id))!), 201)
    }
    return fail(405, "method_not_allowed", "Use GET or POST.")
  }

  const app = await findApp(env, segments[0])
  if (!app) return fail(404, "app_not_found", "No app matches that id or slug.")
  const [, sub, ...rest] = segments

  if (!sub) {
    if (method === "GET") return reply(serializeApp((await getAppSummary(env, app.id))!))
    if (method === "PATCH") {
      const denied = need(ctx, "manage")
      if (denied) return denied
      const body = await readJson(request)
      if (body instanceof Response) return body
      const parsed = applyAppBody(body, toAppInput(app), await getStatusSetForApp(env, app.id))
      if ("response" in parsed) return parsed.response
      const updated = await updateApp(env, app, parsed.input)
      return "error" in updated ? fail(409, "slug_taken", updated.error) : reply(serializeApp((await getAppSummary(env, app.id))!))
    }
    if (method === "DELETE") {
      const denied = need(ctx, "full")
      if (denied) return denied
      const result = await deleteApp(env, app)
      return "error" in result ? fail(409, "app_not_empty", result.error) : reply({ deleted: true, id: app.id })
    }
    return fail(405, "method_not_allowed", "Use GET, PATCH or DELETE.")
  }

  if (sub === "licenses" && rest.length === 0) {
    if (method === "GET") return listLicensesResponse(ctx, app.id)
    if (method === "POST") return createLicenseResponse(ctx, app)
    return fail(405, "method_not_allowed", "Use GET or POST.")
  }
  if (sub === "files") return filesRoute(ctx, { app }, rest[0])
  if (sub === "statuses") return statusRoute(ctx, { app: app.id }, await getStatusSetForApp(env, app.id), rest)
  return fail(404, "not_found", `Unknown endpoint. See ${origin}/api/v1/openapi.json.`)
}

// ---- entry point ------------------------------------------------------------------

export async function handleApi(request: Request, env: Env, execution: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/+$/, "") || "/"
  if (path === "/openapi.json" && request.method === "GET") return reply(openApiSpec(url.origin))

  const key = await authenticate(request, env, execution)
  if (!key) return fail(401, "unauthorized", "Send a valid API key as Authorization: Bearer wk_...")
  const ctx: Context = { env, request, url, origin: url.origin, key }

  const [resource, ...rest] = path.split("/").filter(Boolean)
  if (resource === "me" && request.method === "GET") return reply({ name: key.name, scope: key.scope, prefix: key.prefix })
  if (resource === "stats" && request.method === "GET") {
    const stats = await overviewStats(env)
    return reply({ total: stats.total, in_force: stats.inForce, not_in_force: stats.notInForce, expiring_within_14_days: stats.endingSoon, not_checked_for_3_days: stats.silent, by_status: stats.byStatus })
  }
  if (resource === "licenses") return licenseRoute(ctx, rest)
  if (resource === "apps") return appRoute(ctx, rest)
  if (resource === "statuses" && rest.length === 0 && request.method === "GET") return reply({ data: DEFAULT_STATUSES.map(serializeStatus) })
  return fail(404, "not_found", "Unknown endpoint. See /api/v1/openapi.json.")
}
