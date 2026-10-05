import { redirect } from "react-router"
import type { Route } from "./+types/apps.new"
import { AppForm, EMPTY_APP_FORM } from "#/components/app-form"
import { PageHeader } from "#/components/page-header"
import { DEFAULT_STATUSES, defaultStatusKey, parseStatusDraft } from "#/lib/statuses"
import { requireAuth } from "~/server/auth.server"
import { createApp, readAppForm } from "~/server/apps.server"
import { saveStatusSet } from "~/server/statuses.server"

export const meta: Route.MetaFunction = () => [{ title: "New app | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return { statuses: DEFAULT_STATUSES }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  // Statuses customised in the form arrive as JSON and are stored together with the new app.
  const rawStatuses = String(form.get("statuses_json") ?? "")
  const drafted = rawStatuses ? parseStatusDraft(rawStatuses) : null
  if (drafted && "error" in drafted) return { error: drafted.error }
  const ownStatuses = drafted?.set
  const parsed = readAppForm(form, ownStatuses ?? DEFAULT_STATUSES)
  if ("error" in parsed) return { error: parsed.error }
  const created = await createApp(env, parsed.input)
  if ("error" in created) return { error: created.error }
  if (ownStatuses) await saveStatusSet(env, { app: created.app.id }, ownStatuses)
  return redirect(`/apps/${created.app.id}`)
}

export default function NewApp({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader crumbs={[{ label: "Apps", to: "/apps" }, { label: "New app" }]} />
      <div className="p-4 pt-0">
        <h1 className="mb-1 text-2xl font-bold">New app</h1>
        <p className="mb-6 text-sm text-muted-foreground">An app is a product you license to many customers. Licences issued under it share its defaults and its releases.</p>
        <AppForm values={{ ...EMPTY_APP_FORM, default_status: defaultStatusKey(loaderData.statuses) }} statuses={loaderData.statuses} error={actionData?.error} submitLabel="Create app" cancelTo="/apps" allowStatusCustomisation />
      </div>
    </>
  )
}
