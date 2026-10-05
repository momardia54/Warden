import { Link, redirect } from "react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import type { Route } from "./+types/apps.$appId"
import { ConfirmAction } from "#/components/confirm-action"
import { FilesSection } from "#/components/files-section"
import { HelpTip } from "#/components/help-tip"
import { LicensesTable } from "#/components/licenses-table"
import { PageHeader } from "#/components/page-header"
import { StatCard } from "#/components/stat-card"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Button } from "#/components/ui/button"
import { StatusSection } from "#/components/status-section"
import { DEFAULT_STATUSES, statusLabel } from "#/lib/statuses"
import { requireAuth } from "~/server/auth.server"
import { deleteApp, getApp, getAppSummary } from "~/server/apps.server"
import { deleteFile, getFile, listFiles, storageConfigured, updateFile } from "~/server/files.server"
import { applyStatusForm, getStatusSetForApp, hasCustomSet, statusCounts } from "~/server/statuses.server"
import { queryLicenses } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "App | Warden" }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getAppSummary(env, params.appId)
  if (!app) throw new Response("App not found", { status: 404 })
  const custom = await hasCustomSet(env, { app: app.id })
  const [licenses, files, statuses, usage] = await Promise.all([
    queryLicenses(env, { appId: app.id, limit: 1000 }),
    listFiles(env, { app }),
    getStatusSetForApp(env, app.id),
    custom ? statusCounts(env, { app: app.id }) : Promise.resolve({}),
  ])
  return { app, licenses, files, statuses, custom, usage, filesConfigured: storageConfigured(env) }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getApp(env, params.appId)
  if (!app) throw new Response("App not found", { status: 404 })
  const form = await request.formData()
  const intent = String(form.get("intent"))

  if (intent.endsWith("-status") || intent.endsWith("-statuses")) return applyStatusForm(env, { app: app.id }, form)
  if (intent === "update-file") {
    const file = await getFile(env, { app }, String(form.get("fileId")))
    if (file) await updateFile(env, { app }, file, { statuses: String(form.get("statuses") ?? ""), checkDomain: form.get("check_domain") === "true", version: String(form.get("version") ?? "") })
  } else if (intent === "delete-file") {
    const file = await getFile(env, { app }, String(form.get("fileId")))
    if (file) await deleteFile(env, { app }, file)
  } else if (intent === "delete") {
    const result = await deleteApp(env, app)
    if ("error" in result) return { error: result.error }
    return redirect("/apps")
  }
  return null
}

export default function AppPage({ loaderData, actionData }: Route.ComponentProps) {
  const actionError = actionData && "error" in actionData ? actionData.error : null
  const { app, licenses, files, statuses, custom, usage, filesConfigured } = loaderData
  const defaults = [
    statusLabel(statuses, app.default_status),
    app.default_duration_days ? `${app.default_duration_days} days` : "no expiry",
    app.default_max_sites ? `${app.default_max_sites} site${app.default_max_sites === 1 ? "" : "s"}` : "unlimited sites",
  ].join(" · ")

  return (
    <>
      <PageHeader crumbs={[{ label: "Apps", to: "/apps" }, { label: app.name }]} />
      <div className="max-w-5xl space-y-6 p-4 pt-0">
        {actionError && (
          <Alert variant="destructive">
            <AlertTitle>The app was not deleted</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{app.name}</h1>
            <p className="text-sm text-muted-foreground">
              <code>{app.slug}</code>
              {app.description ? ` · ${app.description}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/licenses/new?app=${app.id}`}>
                <Plus /> Issue licence
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/apps/${app.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Licences" value={app.licenses} />
          <StatCard title="In force" value={app.in_force} help="Licences that are currently valid for sites: Completed, or Active and not past their expiry date." />
          <StatCard title="Sites in use" value={app.sites} help="Total number of sites (domains) registered across all licences of this app." />
          <StatCard title="Latest version" value={app.latest_version ? `v${app.latest_version}` : "None"} help="The highest version among the app's released files." />
        </div>

        <p className="text-sm text-muted-foreground">
          Defaults for new licences: <span className="text-foreground">{defaults}</span>
          {app.default_message ? <> · public message set</> : null}{" "}
          <HelpTip>New licences issued under this app start with these values. You can change them per licence.</HelpTip>
        </p>

        <FilesSection
          title="Releases"
          description="Files shared by every licence of this app, for example plugin or theme versions. Each file is released by licence status. Licences see them on their own page and through their download link."
          uploadPath={`/apps/${app.id}/files`}
          files={files}
          statuses={statuses}
          configured={filesConfigured}
        />

        <StatusSection owner="app" statuses={statuses} fallback={DEFAULT_STATUSES} custom={custom} usage={usage} actionPath={`/apps/${app.id}`} inheritedFrom="the default statuses" />

        <section className="space-y-2">
          <h2 className="font-semibold">Licences</h2>
          <LicensesTable licenses={licenses} showApp={false} empty="No licence has been issued under this app yet." />
        </section>

        <ConfirmAction
          intent="delete"
          trigger={
            <Button variant="outline" className="text-destructive">
              <Trash2 /> Delete app
            </Button>
          }
          title="Delete this app?"
          description={
            app.licenses > 0
              ? `This app still has ${app.licenses} licence${app.licenses === 1 ? "" : "s"}. Delete them or move them to another app first; the app cannot be deleted until then.`
              : "The app and its released files are deleted. This cannot be undone."
          }
          confirm="Delete app"
        />
      </div>
    </>
  )
}
