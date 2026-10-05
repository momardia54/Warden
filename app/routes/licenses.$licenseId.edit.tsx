import { redirect } from "react-router"
import type { Route } from "./+types/licenses.$licenseId.edit"
import { PageHeader } from "#/components/page-header"
import { LicenseForm } from "#/components/license-form"
import { requireAuth } from "~/server/auth.server"
import { getApp, listApps } from "~/server/apps.server"
import { loadStatusSets } from "~/server/statuses.server"
import { getLicense, readLicenseForm, updateLicense } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "Edit licence | Warden" }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Not found", { status: 404 })
  return { license, apps: (await listApps(env)).map((a) => ({ id: a.id, name: a.name })) }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Not found", { status: 404 })
  const parsed = readLicenseForm(await request.formData(), await loadStatusSets(env), license.id)
  if ("error" in parsed) return { error: parsed.error }
  if (parsed.input.app_id && !(await getApp(env, parsed.input.app_id))) return { error: "The selected app no longer exists." }
  await updateLicense(env, license, parsed.input)
  return redirect(`/licenses/${license.id}`)
}

export default function EditLicense({ loaderData, actionData }: Route.ComponentProps) {
  const { license, apps } = loaderData
  const values = {
    name: license.name,
    customer_name: license.customer_name,
    customer_email: license.customer_email,
    app_id: license.app_id ?? "",
    max_sites: license.max_sites?.toString() ?? "",
    status: license.status,
    expires: license.expires_at ? new Date(license.expires_at).toISOString().slice(0, 10) : "",
    domains: license.domains,
    message: license.message,
    notes: license.notes,
  }
  return (
    <>
      <PageHeader crumbs={[{ label: "Licences", to: "/licenses" }, { label: license.name, to: `/licenses/${license.id}` }, { label: "Edit" }]} />
      <div className="p-4 pt-0">
        <h1 className="mb-6 text-2xl font-bold">Edit licence</h1>
        <LicenseForm values={values} apps={apps} licenseId={license.id} error={actionData?.error} submitLabel="Save changes" cancelTo={`/licenses/${license.id}`} />
      </div>
    </>
  )
}
