import { redirect } from "react-router"
import type { Route } from "./+types/licenses.$licenseId.edit"
import { PageHeader } from "#/components/page-header"
import { LicenseForm } from "#/components/license-form"
import { requireAuth } from "~/server/auth.server"
import { getLicense, readLicenseForm, updateLicense } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "Edit licence | Warden" }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Not found", { status: 404 })
  return { license }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Not found", { status: 404 })
  const parsed = readLicenseForm(await request.formData())
  if ("error" in parsed) return { error: parsed.error }
  await updateLicense(env, license, parsed.input)
  return redirect(`/licenses/${license.id}`)
}

export default function EditLicense({ loaderData, actionData }: Route.ComponentProps) {
  const { license } = loaderData
  const values = {
    name: license.name,
    client: license.client,
    // A stored "expired" status is never offered; the end date decides that.
    status: license.status === "expired" ? "active" : license.status,
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
        <LicenseForm values={values} error={actionData?.error} submitLabel="Save changes" cancelTo={`/licenses/${license.id}`} />
      </div>
    </>
  )
}
