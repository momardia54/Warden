import { useState } from "react"
import { Form, Link, redirect, useFetcher, useNavigation, useSearchParams } from "react-router"
import { CalendarPlus, Pencil, RefreshCw, Trash2 } from "lucide-react"
import type { App } from "~/server/apps.server"
import type { Route } from "./+types/licenses.$licenseId"
import { ConfirmAction } from "#/components/confirm-action"
import { FilesSection } from "#/components/files-section"
import { HelpTip } from "#/components/help-tip"
import { PageHeader } from "#/components/page-header"
import { LicenseStatusBadge } from "#/components/status-badge"
import { CodeBlock, CopyField } from "#/components/code-block"
import { Ago, When } from "#/components/time"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Button } from "#/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "#/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { useStatusSetForLicense } from "#/components/status-context"
import { StatusSection } from "#/components/status-section"
import { effectiveStatusKey, findStatus, statusLabel } from "#/lib/statuses"
import { requireAuth } from "~/server/auth.server"
import { deleteFile, getFile, listFiles, storageConfigured, updateFile } from "~/server/files.server"
import { formatSites } from "#/components/licenses-table"
import { applyStatusForm, getStatusSetForApp, getStatusSetForLicense, hasCustomSet, statusCounts } from "~/server/statuses.server"
import { deleteLicense, listActivations, releaseActivation, extendLicense, getLicense, recentActivity, regenerateKey, setStatus } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "Licence | Warden" }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Licence not found", { status: 404 })
  const origin = new URL(request.url).origin
  const [activity, files, sharedFiles, sites] = await Promise.all([
    recentActivity(env, license.id),
    listFiles(env, { license }),
    license.app_id ? listFiles(env, { app: { id: license.app_id } as App }) : Promise.resolve([]),
    listActivations(env, license.id),
  ])
  const customStatuses = await hasCustomSet(env, { license: license.id })
  const [fallbackStatuses, usage] = await Promise.all([getStatusSetForApp(env, license.app_id), statusCounts(env, { license: license.id })])
  return { license, activity, files, sharedFiles, sites, customStatuses, fallbackStatuses, statusUsage: usage, filesConfigured: storageConfigured(env), origin, checkUrl: `${origin}/check/${license.license_key}` }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Licence not found", { status: 404 })
  const form = await request.formData()
  const intent = String(form.get("intent"))

  if (intent.endsWith("-status") && intent !== "status" || intent.endsWith("-statuses")) return applyStatusForm(env, { license: license.id }, form)
  if (intent === "status") {
    const status = String(form.get("status"))
    if (findStatus(await getStatusSetForLicense(env, license), status)) await setStatus(env, license, status)
  } else if (intent === "extend") {
    const days = Number(form.get("days"))
    if (Number.isInteger(days) && days > 0 && days <= 3650) await extendLicense(env, license, days)
  } else if (intent === "regenerate") {
    await regenerateKey(env, license)
  } else if (intent === "update-file") {
    const file = await getFile(env, { license }, String(form.get("fileId")))
    if (file) await updateFile(env, { license }, file, { statuses: String(form.get("statuses") ?? ""), checkDomain: form.get("check_domain") === "true", version: String(form.get("version") ?? "") })
  } else if (intent === "delete-file") {
    const file = await getFile(env, { license }, String(form.get("fileId")))
    if (file) await deleteFile(env, { license }, file)
  } else if (intent === "release-site") {
    await releaseActivation(env, license, String(form.get("domain") ?? ""))
  } else if (intent === "delete") {
    await deleteLicense(env, license.id)
    return redirect("/licenses")
  }
  return null
}

function Fact({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {help && <HelpTip>{help}</HelpTip>}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function SiteRelease({ domain }: { domain: string }) {
  const fetcher = useFetcher()
  return (
    <Button variant="outline" size="sm" disabled={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "release-site", domain }, { method: "post" })}>
      Release site
    </Button>
  )
}

export default function LicensePage({ loaderData }: Route.ComponentProps) {
  const { license, activity, files, sharedFiles, sites, customStatuses, fallbackStatuses, statusUsage, filesConfigured, origin, checkUrl } = loaderData
  const [params] = useSearchParams()
  const statuses = useStatusSetForLicense(license)
  const effective = effectiveStatusKey(license, statuses)
  const curl = `curl "${checkUrl}?domain=example.com"`

  return (
    <>
      <PageHeader crumbs={[{ label: "Licences", to: "/licenses" }, { label: license.name }]} />
      <div className="max-w-4xl space-y-6 p-4 pt-0">
        {params.get("created") && (
          <Alert>
            <AlertTitle>Licence created</AlertTitle>
            <AlertDescription>Copy the key or the check URL below into the client&apos;s site code.</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              {license.name} <LicenseStatusBadge license={license} />
            </h1>
            <p className="text-sm text-muted-foreground">
              {[license.customer_name, license.customer_email].filter(Boolean).join(" · ")}
              {license.app_id && (
                <>
                  {license.customer_name || license.customer_email ? " · " : ""}
                  App: <Link className="text-foreground underline underline-offset-2" to={`/apps/${license.app_id}`}>{license.app_name}</Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to={`/licenses/${license.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Change status</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {statuses.map((s) => (
                  <Form method="post" key={s.key}>
                    <input type="hidden" name="intent" value="status" />
                    <input type="hidden" name="status" value={s.key} />
                    <DropdownMenuItem asChild disabled={license.status === s.key}>
                      <button type="submit" className="w-full flex-col items-start gap-0.5 text-left">
                        <span className="font-medium">{s.label}</span>
                        <span className="text-xs text-muted-foreground">{s.description}</span>
                      </button>
                    </DropdownMenuItem>
                  </Form>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <CalendarPlus /> Extend expiry
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {[30, 90, 365].map((days) => (
                  <Form method="post" key={days}>
                    <input type="hidden" name="intent" value="extend" />
                    <input type="hidden" name="days" value={days} />
                    <DropdownMenuItem asChild>
                      <button type="submit" className="w-full">
                        {days === 365 ? "+ 1 year" : `+ ${days} days`}
                      </button>
                    </DropdownMenuItem>
                  </Form>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Licence key and check URL</h2>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Licence key <HelpTip>Identifies and authenticates this licence. Anyone holding it can check the licence status and download the files it allows. Treat it as a secret.</HelpTip>
            </p>
            <CopyField value={license.license_key} />
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Check URL{" "}
              <HelpTip>
                The endpoint the client&apos;s site calls (GET), for example every 12 hours. It returns JSON with valid, status, message and expires_at, signed in the X-Warden-Signature header (HMAC-SHA256 of the body, keyed with the licence key).
                Append ?domain=example.com so domain restrictions can be applied.
              </HelpTip>
            </p>
            <CopyField value={checkUrl} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Example request</p>
            <CodeBlock code={curl} language="bash" />
          </div>
          <ConfirmAction
            intent="regenerate"
            trigger={
              <Button variant="outline" size="sm">
                <RefreshCw /> Regenerate key
              </Button>
            }
            title="Regenerate the key?"
            description="The current key and check URL stop working immediately. The site will need the new key."
            confirm="Regenerate"
          />
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 font-semibold">Details</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Fact label="Status reported to sites" help="What the check endpoint returns right now. It differs from the stored status only when the status has an expiry rule and the expiry date has passed.">{statusLabel(statuses, effective)}</Fact>
            <Fact label="Expires">{license.expires_at ? `${new Date(license.expires_at).toISOString().slice(0, 10)} (end of day, UTC)` : "Never"}</Fact>
            <Fact label="Allowed domains" help="Sites must send one of these as ?domain= for the licence to be valid.">{license.domains || "Any domain"}</Fact>
            <Fact label="Sites in use" help="How many different sites (domains) have registered with this licence, and the maximum allowed.">{formatSites(license)}</Fact>
            <Fact label="Last check" help="The last time a site called the check URL, and the domain it reported.">
              <Ago ts={license.last_check_at} />
              {license.last_check_domain ? ` from ${license.last_check_domain}` : ""}
            </Fact>
            <Fact label="Total checks">{license.check_count}</Fact>
            <Fact label="Created">
              <When ts={license.created_at} />
            </Fact>
            {license.message && <Fact label="Public message" help="Returned to sites in the check response.">{license.message}</Fact>}
            {license.notes && <Fact label="Internal notes">{license.notes}</Fact>}
          </dl>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <div>
            <h2 className="flex items-center gap-1.5 font-semibold">
              Sites <HelpTip>A site registers automatically the first time it checks this licence with its domain (?domain=). When the licence has a site limit, further sites are refused once it is reached. Release a site to free its slot.</HelpTip>
            </h2>
            <p className="text-xs text-muted-foreground">{formatSites(license)} in use</p>
          </div>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No site has checked this licence with a domain yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {sites.map((site) => (
                <li key={site.domain} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{site.domain}</span>
                    <div className="text-xs text-muted-foreground">
                      First seen <Ago ts={site.first_seen_at} /> · last check <Ago ts={site.last_seen_at} /> · {site.check_count} check{site.check_count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <SiteRelease domain={site.domain} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <StatusSection
          owner="licence"
          statuses={statuses}
          fallback={fallbackStatuses}
          custom={customStatuses}
          usage={statusUsage}
          actionPath={`/licenses/${license.id}`}
          inheritedFrom={license.app_id ? `the statuses of the app ${license.app_name}` : "the default statuses"}
        />

        <FilesSection
          description="Downloads released by licence status. Each file lists the statuses in which it can be downloaded."
          uploadPath={`/licenses/${license.id}/files`}
          downloadUrl={(fileId) => `${origin}/download/${license.license_key}/${fileId}`}
          license={license}
          statuses={statuses}
          files={files}
          shared={license.app_id && sharedFiles.length > 0 ? { appName: license.app_name ?? "App", appHref: `/apps/${license.app_id}`, files: sharedFiles, statuses: fallbackStatuses } : null}
          configured={filesConfigured}
        />

        <section className="space-y-2">
          <h2 className="font-semibold">Activity</h2>
          <div className="rounded-lg border">
            {activity.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span>
                      {a.event === "check" ? (
                        <>
                          Check from <span className="font-medium">{a.domain ?? "unknown domain"}</span>: {statusLabel(statuses, a.status)}
                        </>
                      ) : a.event === "download" ? (
                        <>
                          {a.detail}
                          {a.domain ? <> from <span className="font-medium">{a.domain}</span></> : null}
                        </>
                      ) : (
                        a.detail
                      )}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      <Ago ts={a.at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <ConfirmAction
          intent="delete"
          trigger={
            <Button variant="outline" className="text-destructive">
              <Trash2 /> Delete licence
            </Button>
          }
          title="Delete this licence?"
          description="Its history is deleted too, and the check URL returns 'unknown' from now on, which a site will treat as invalid. To switch a site off but keep the record, set the status to Disabled instead."
          confirm="Delete"
        />
      </div>
    </>
  )
}
