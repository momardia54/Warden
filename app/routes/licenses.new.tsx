import { redirect } from "react-router"
import type { Route } from "./+types/licenses.new"
import { PageHeader } from "#/components/page-header"
import { EMPTY_FORM, LicenseForm } from "#/components/license-form"
import { requireAuth } from "~/server/auth.server"
import { createLicense, readLicenseForm } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "New licence | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAuth(request, context.cloudflare.env)
  return null
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const parsed = readLicenseForm(form)
  if ("error" in parsed) return { error: parsed.error }
  const license = await createLicense(env, parsed.input)
  return redirect(`/licenses/${license.id}?created=1`)
}

export default function NewLicense({ actionData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader crumbs={[{ label: "Licences", to: "/licenses" }, { label: "New licence" }]} />
      <div className="p-4 pt-0">
        <h1 className="mb-1 text-2xl font-bold">New licence</h1>
        <p className="mb-6 text-sm text-muted-foreground">The key and check URL are generated when you save.</p>
        <LicenseForm values={EMPTY_FORM} error={actionData?.error} submitLabel="Create licence" cancelTo="/licenses" />
      </div>
    </>
  )
}
