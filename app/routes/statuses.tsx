import type { Route } from "./+types/statuses"
import { PageHeader } from "#/components/page-header"
import { StatusEditor } from "#/components/status-editor"
import { requireAuth } from "~/server/auth.server"
import { applyStatusForm, getStatusSet, statusCounts } from "~/server/statuses.server"

export const meta: Route.MetaFunction = () => [{ title: "Statuses | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return { statuses: await getStatusSet(env, null), usage: await statusCounts(env, null) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return applyStatusForm(env, null, await request.formData())
}

export default function Statuses({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader crumbs={[{ label: "Statuses" }]} />
      <div className="max-w-3xl space-y-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-bold">Statuses</h1>
          <p className="text-sm text-muted-foreground">
            The default statuses of every licence. Rename them, change what they mean, remove the ones you do not need and add your own. An app can have its own set of statuses instead; see the app page.
          </p>
        </div>
        <StatusEditor statuses={loaderData.statuses} usage={loaderData.usage} actionPath="/statuses" />
      </div>
    </>
  )
}
