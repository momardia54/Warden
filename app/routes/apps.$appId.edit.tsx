import { redirect } from "react-router"
import type { Route } from "./+types/apps.$appId.edit"
import { AppForm } from "#/components/app-form"
import { PageHeader } from "#/components/page-header"
import { requireAuth } from "~/server/auth.server"
import { getApp, readAppForm, updateApp } from "~/server/apps.server"
import { getStatusSet } from "~/server/statuses.server"

export const meta: Route.MetaFunction = () => [{ title: "Edit app | Warden" }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getApp(env, params.appId)
  if (!app) throw new Response("App not found", { status: 404 })
  return { app, statuses: await getStatusSet(env, app.id) }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getApp(env, params.appId)
  if (!app) throw new Response("App not found", { status: 404 })
  const parsed = readAppForm(await request.formData(), await getStatusSet(env, app.id))
  if ("error" in parsed) return { error: parsed.error }
  const updated = await updateApp(env, app, parsed.input)
  if ("error" in updated) return { error: updated.error }
  return redirect(`/apps/${app.id}`)
}

export default function EditApp({ loaderData, actionData }: Route.ComponentProps) {
  const { app, statuses } = loaderData
  const values = {
    name: app.name,
    slug: app.slug,
    description: app.description,
    default_status: app.default_status,
    default_duration_days: app.default_duration_days?.toString() ?? "",
    default_max_sites: app.default_max_sites?.toString() ?? "",
    default_message: app.default_message,
    notes: app.notes,
  }
  return (
    <>
      <PageHeader crumbs={[{ label: "Apps", to: "/apps" }, { label: app.name, to: `/apps/${app.id}` }, { label: "Edit" }]} />
      <div className="p-4 pt-0">
        <h1 className="mb-6 text-2xl font-bold">Edit app</h1>
        <AppForm values={values} statuses={statuses} error={actionData?.error} submitLabel="Save changes" cancelTo={`/apps/${app.id}`} />
      </div>
    </>
  )
}
