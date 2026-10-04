import { useEffect, useState } from "react"
import { Link, redirect, useFetcher } from "react-router"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { NativeSelect } from "#/components/ui/native-select"
import { FieldLabel } from "#/components/help-tip"
import { StatusEditor } from "#/components/status-editor"
import { findStatus, statusLabel, type StatusSet } from "#/lib/statuses"
import { requireAuth } from "~/server/auth.server"
import { deleteApp, getApp, getAppSummary } from "~/server/apps.server"
import { deleteFile, getFile, listFiles, storageConfigured, updateFile } from "~/server/files.server"
import { applyStatusForm, getStatusSet, hasCustomSet, statusCounts } from "~/server/statuses.server"
import { queryLicenses } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "App | Warden" }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getAppSummary(env, params.appId)
  if (!app) throw new Response("App not found", { status: 404 })
  const custom = await hasCustomSet(env, app.id)
  const [licenses, files, statuses, defaults, usage] = await Promise.all([
    queryLicenses(env, { appId: app.id, limit: 1000 }),
    listFiles(env, { app }),
    getStatusSet(env, app.id),
    getStatusSet(env, null),
    custom ? statusCounts(env, app.id) : Promise.resolve({}),
  ])
  return { app, licenses, files, statuses, defaults, custom, usage, filesConfigured: storageConfigured(env) }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getApp(env, params.appId)
  if (!app) throw new Response("App not found", { status: 404 })
  const form = await request.formData()
  const intent = String(form.get("intent"))

  if (intent.endsWith("-status") || intent.endsWith("-statuses")) return applyStatusForm(env, app.id, form)
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

function CustomizeStatuses({ appId }: { appId: string }) {
  const fetcher = useFetcher<{ ok?: true; error?: string } | null>()
  return (
    <>
      <Button variant="outline" disabled={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "customize-statuses" }, { method: "post", action: `/apps/${appId}` })}>
        Customise statuses for this app
      </Button>
      {fetcher.data?.error && <p className="w-full text-sm text-destructive">{fetcher.data.error}</p>}
    </>
  )
}

/** Returns an app to the default statuses. Statuses the default set lacks, and that licences use, need a replacement. */
function ResetStatuses({ appId, custom, defaults, usage }: { appId: string; custom: StatusSet; defaults: StatusSet; usage: Record<string, number> }) {
  const fetcher = useFetcher<{ ok?: true; error?: string } | null>()
  const [open, setOpen] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const missing = custom.filter((s) => !findStatus(defaults, s.key))
  const needed = missing.filter((s) => (usage[s.key] ?? 0) > 0)

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false)
  }, [fetcher.state, fetcher.data])

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Use the default statuses again
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Use the default statuses again?</DialogTitle>
            <DialogDescription>This app&apos;s own statuses are removed. Licences move to the default status with the same identifier; the ones below have no match.</DialogDescription>
          </DialogHeader>
          {needed.length > 0 ? (
            <div className="space-y-3">
              {needed.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <FieldLabel htmlFor={`map-${s.key}`}>
                    {s.label} ({usage[s.key]} licence{usage[s.key] === 1 ? "" : "s"}) moves to
                  </FieldLabel>
                  <NativeSelect id={`map-${s.key}`} value={mapping[s.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [s.key]: e.target.value })}>
                    <option value="">Choose a status</option>
                    {defaults.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No licence uses a status that the default set lacks.</p>
          )}
          {fetcher.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{fetcher.data.error}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={fetcher.state !== "idle"}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={fetcher.state !== "idle" || needed.some((s) => !mapping[s.key])}
              onClick={() => fetcher.submit({ intent: "reset-statuses", ...Object.fromEntries(Object.entries(mapping).map(([k, v]) => [`map_${k}`, v])) }, { method: "post", action: `/apps/${appId}` })}
            >
              Remove the app's statuses
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function AppPage({ loaderData, actionData }: Route.ComponentProps) {
  const actionError = actionData && "error" in actionData ? actionData.error : null
  const { app, licenses, files, statuses, defaults: defaultStatuses, custom, usage, filesConfigured } = loaderData
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

        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-1.5 font-semibold">
              Statuses <HelpTip>The statuses licences of this app can have. By default an app uses the default statuses of the installation. Customising gives this app its own copy that you can change freely without affecting other apps.</HelpTip>
            </h2>
            <p className="text-xs text-muted-foreground">{custom ? "This app has its own statuses." : `This app uses the default statuses (${defaultStatuses.map((s) => s.label).join(", ")}).`}</p>
          </div>
          {custom ? (
            <>
              <StatusEditor statuses={statuses} usage={usage} actionPath={`/apps/${app.id}`} />
              <ResetStatuses appId={app.id} custom={statuses} defaults={defaultStatuses} usage={usage} />
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <CustomizeStatuses appId={app.id} />
              <Button asChild variant="outline">
                <Link to="/statuses">Edit the default statuses</Link>
              </Button>
            </div>
          )}
        </section>

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
