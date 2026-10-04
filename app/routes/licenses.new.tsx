import { redirect } from "react-router"
import type { Route } from "./+types/licenses.new"
import { PageHeader } from "#/components/page-header"
import { EMPTY_FORM, LicenseForm, type FormValues } from "#/components/license-form"
import { defaultStatusKey, statusLabel } from "#/lib/statuses"
import { requireAuth } from "~/server/auth.server"
import { appDefaults, getApp, listApps } from "~/server/apps.server"
import { getStatusSet, loadStatusSets } from "~/server/statuses.server"
import { createLicense, readLicenseForm } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "New licence | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const apps = (await listApps(env)).map((a) => ({ id: a.id, name: a.name }))
  const appId = new URL(request.url).searchParams.get("app")
  const app = appId ? await getApp(env, appId) : null
  if (!app) return { apps, values: { ...EMPTY_FORM, status: defaultStatusKey(await getStatusSet(env, null)) }, appHint: "" }

  const defaults = appDefaults(app)
  const values: FormValues = {
    ...EMPTY_FORM,
    app_id: app.id,
    status: defaults.status,
    expires: defaults.expires_at ? new Date(defaults.expires_at).toISOString().slice(0, 10) : "",
    max_sites: defaults.max_sites?.toString() ?? "",
    message: defaults.message,
  }
  const parts = [
    app.default_duration_days ? `expires after ${app.default_duration_days} days` : "no expiry",
    app.default_max_sites ? `${app.default_max_sites} site${app.default_max_sites === 1 ? "" : "s"}` : "unlimited sites",
    `status ${statusLabel(await getStatusSet(env, app.id), defaults.status)}`,
  ]
  return { apps, values, appHint: `Defaults from ${app.name} applied: ${parts.join(", ")}. You can change any of them.` }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const parsed = readLicenseForm(await request.formData(), await loadStatusSets(env))
  if ("error" in parsed) return { error: parsed.error }
  if (parsed.input.app_id && !(await getApp(env, parsed.input.app_id))) return { error: "The selected app no longer exists." }
  const license = await createLicense(env, parsed.input)
  return redirect(`/licenses/${license.id}?created=1`)
}

export default function NewLicense({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader crumbs={[{ label: "Licences", to: "/licenses" }, { label: "New licence" }]} />
      <div className="p-4 pt-0">
        <h1 className="mb-1 text-2xl font-bold">New licence</h1>
        <p className="mb-6 text-sm text-muted-foreground">The key and check URL are generated when you save.</p>
        <LicenseForm values={loaderData.values} apps={loaderData.apps} appHint={loaderData.appHint} error={actionData?.error} submitLabel="Create licence" cancelTo="/licenses" reloadOnAppChange />
      </div>
    </>
  )
}
