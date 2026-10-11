import { useState } from "react"
import { Form, Link, redirect, useFetcher, useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router"
import { ArrowDownToLine, CalendarPlus, Check, ChevronDown, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react"
import type { App } from "~/server/apps.server"
import type { Route } from "./+types/licenses.$licenseId"
import { ColumnChart } from "#/components/column-chart"
import { IpAddress } from "#/components/ip-address"
import { ConfirmAction } from "#/components/confirm-action"
import { Fact, FactStrip } from "#/components/fact-strip"
import { FilesSection } from "#/components/files-section"
import { HelpTip } from "#/components/help-tip"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { onlyTabChanged, RouteTabs, useRouteTab } from "#/components/route-tabs"
import { LicenseStatusBadge, StatusBadge } from "#/components/status-badge"
import { CodeBlock, CopyField } from "#/components/code-block"
import { Ago, When } from "#/components/time"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { useStatusSetForLicense } from "#/components/status-context"
import { StatusSection } from "#/components/status-section"
import { evaluateFileAccess } from "#/lib/files"
import { isOutdated, latestRelease } from "#/lib/releases"
import { DEFAULT_COLOR, DEFAULT_STATUSES, effectiveStatusKey, findStatus, splitStatusKeys, statusLabel } from "#/lib/statuses"
import { daysUntil, describeExpiry, EXPIRING_WINDOW_DAYS } from "#/lib/views"
import { cn } from "#/lib/utils"
import { dailyTraffic } from "~/server/analytics.server"
import { blockedAmong } from "~/server/ip-blocks.server"
import { requireAuth } from "~/server/auth.server"
import { applyFileForm, listFiles, storageConfigured } from "~/server/files.server"
import { applySourceForm, trackPanels } from "~/server/sources.server"
import { applyTrackForm, listAppTracks } from "~/server/tracks.server"
import { trackForStatus, trackView } from "#/lib/tracks"
import { getGitHubApp } from "~/server/github-app.server"
import { getSigningKey } from "~/server/signing.server"
import { formatSites } from "#/components/licenses-table"
import { applyStatusForm, getStatusSetForLicense, hasCustomSet, statusCounts } from "~/server/statuses.server"
import { deleteLicense, listActivations, releaseActivation, extendLicense, getLicense, recentActivity, regenerateKey, setStatus } from "~/server/licenses.server"

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.license.name ?? "Licence"} | Warden` }]

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Licence not found", { status: 404 })
  const origin = new URL(request.url).origin
  const [activity, files, appFiles, sites, set, customStatuses, statusUsage, traffic, tracks, appTracks] = await Promise.all([
    recentActivity(env, license.id, 100),
    listFiles(env, { license }),
    license.app_id ? listFiles(env, { app: { id: license.app_id } as App }) : Promise.resolve([]),
    listActivations(env, license.id),
    getStatusSetForLicense(env, license),
    hasCustomSet(env, { license: license.id }),
    statusCounts(env, { license: license.id }),
    dailyTraffic(env, { license: license.id }, 30, Date.now(), "checks"),
    trackPanels(env, { license }, origin),
    license.app_id ? listAppTracks(env, license.app_id) : Promise.resolve([]),
  ])
  // For the statuses the licence's own tracks serve, the app's releases do not apply to it (as in listFilesForLicense).
  const ownKeys = new Set(tracks.flatMap((p) => p.track.statuses))
  const sharedFiles = appFiles.map((f) => (f.track_id && ownKeys.size > 0 ? { ...f, statuses: f.statuses.split(",").filter((k) => k && !ownKeys.has(k)).join(",") } : f))
  // The release a site of this licence is offered now (the domain check aside): newest stable release it can download.
  const now = Date.now()
  const downloadable = [...files, ...sharedFiles].filter((f) => f.withdrawn_at === null && evaluateFileAccess(license, { statuses: splitStatusKeys(f.statuses, set), check_domain: false }, null, now, true, set).allowed)
  const latest = latestRelease(downloadable.sort((a, b) => b.uploaded_at - a.uploaded_at))
  // Which track serves the licence's current status: its own track for that status, otherwise its app's.
  const currentStatus = effectiveStatusKey(license, set, now)
  const appTrackViews = appTracks.map(trackView)
  const receivingTrack = trackForStatus(currentStatus, tracks.map((p) => p.track).map((t) => ({ ...t, statuses: t.statuses.join(",") })), appTrackViews.map((t) => ({ ...t, statuses: t.statuses.join(",") })))
  const blockedIps = await blockedAmong(env, [...activity.map((a) => a.ip), ...sites.map((s) => s.last_ip)])
  return {
    license,
    activity,
    blockedIps,
    traffic: traffic.series,
    files,
    sharedFiles,
    sites,
    set,
    customStatuses,
    statusUsage,
    latestVersion: latest?.version ?? null,
    filesConfigured: storageConfigured(env),
    tracks,
    appTracks: appTrackViews,
    receiving: { trackId: receivingTrack?.track.id ?? null, status: currentStatus },
    githubApp: (await getGitHubApp(env)) !== null,
    origin,
    checkUrl: `${origin}/check/${license.license_key}`,
    signingKey: await getSigningKey(env).then((k) => ({ publicKey: k.publicKey, keyId: k.keyId })),
  }
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return onlyTabChanged(args) ? false : args.defaultShouldRevalidate
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const license = await getLicense(env, params.licenseId)
  if (!license) throw new Response("Licence not found", { status: 404 })
  const form = await request.formData()
  const intent = String(form.get("intent"))

  if ((intent.endsWith("-status") && intent !== "status") || intent.endsWith("-statuses")) return applyStatusForm(env, { license: license.id }, form)
  const fileResult = await applyFileForm(env, { license }, form)
  if (fileResult) return fileResult
  const trackResult = await applyTrackForm(env, { license }, form)
  if (trackResult) return trackResult
  const sourceResult = await applySourceForm(env, context.cloudflare.ctx, { license }, form)
  if (sourceResult) return sourceResult
  if (intent === "status") {
    const status = String(form.get("status"))
    if (!findStatus(await getStatusSetForLicense(env, license), status)) return { error: "That status does not exist for this licence." }
    await setStatus(env, license, status)
  } else if (intent === "extend") {
    const days = Number(form.get("days"))
    if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: "Choose a number of days from 1 to 3650." }
    await extendLicense(env, license, days)
  } else if (intent === "regenerate") {
    await regenerateKey(env, license)
  } else if (intent === "release-site") {
    await releaseActivation(env, license, String(form.get("domain") ?? ""))
  } else if (intent === "delete") {
    await deleteLicense(env, license.id)
    return redirect("/licenses")
  }
  return { ok: true as const }
}

type LoaderData = Route.ComponentProps["loaderData"]

const TABS = ["overview", "sites", "releases", "activity", "statuses"] as const

export default function LicensePage({ loaderData }: Route.ComponentProps) {
  const { license, activity, blockedIps, traffic, files, sharedFiles, sites, customStatuses, statusUsage, latestVersion, filesConfigured, tracks, appTracks, receiving, githubApp, origin, checkUrl, signingKey } = loaderData
  const [params] = useSearchParams()
  const statuses = useStatusSetForLicense(license)
  const [tab, setTab] = useRouteTab([...TABS])
  const [confirm, setConfirm] = useState<"regenerate" | "delete" | null>(null)
  const effective = effectiveStatusKey(license, statuses)
  const reported = findStatus(statuses, effective)
  const valid = reported?.grants_access ?? false
  const outdatedSites = sites.filter((s) => isOutdated(s.version, latestVersion)).length

  const expiryTone = license.expires_at === null ? "default" : daysUntil(license.expires_at) < 0 ? "danger" : daysUntil(license.expires_at) <= EXPIRING_WINDOW_DAYS ? "warning" : "default"
  const silent = license.last_check_at === null || Date.now() - license.last_check_at > 3 * 86_400_000

  return (
    <>
      <PageHeader crumbs={[{ label: "Licences", to: "/licenses" }, ...(license.app_id ? [{ label: license.app_name ?? "App", to: `/apps/${license.app_id}` }] : []), { label: license.name }]} />
      <div className="space-y-6 p-4 pt-0 lg:px-6">
        {params.get("created") && (
          <Alert>
            <Check />
            <AlertTitle>Licence created</AlertTitle>
            <AlertDescription>Put the licence key or the check URL below into the customer&apos;s site.</AlertDescription>
          </Alert>
        )}

        <PageTitle
          title={license.name}
          badge={<LicenseStatusBadge license={license} />}
          description={
            <>
              {[license.customer_name, license.customer_email].filter(Boolean).join(", ") || "No customer recorded"}
              {", "}
              {license.app_id ? (
                <Link className="text-foreground underline-offset-2 hover:underline" to={`/apps/${license.app_id}`}>
                  {license.app_name}
                </Link>
              ) : (
                "standalone licence"
              )}
            </>
          }
          actions={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    Change status <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {statuses.map((s) => (
                    <Form method="post" key={s.key}>
                      <input type="hidden" name="intent" value="status" />
                      <input type="hidden" name="status" value={s.key} />
                      <DropdownMenuItem asChild disabled={license.status === s.key}>
                        <button type="submit" className="w-full items-start text-left">
                          <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              {s.label}
                              {license.status === s.key ? " (current)" : ""}
                            </span>
                            {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
                          </span>
                        </button>
                      </DropdownMenuItem>
                    </Form>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Only offered when the licence expires: extending a licence without an expiry date would give it one. */}
              {license.expires_at !== null && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <CalendarPlus /> Extend
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">From {daysUntil(license.expires_at) < 0 ? "today" : "the current expiry date"}</DropdownMenuLabel>
                    {[30, 90, 365].map((days) => (
                      <Form method="post" key={days}>
                        <input type="hidden" name="intent" value="extend" />
                        <input type="hidden" name="days" value={days} />
                        <DropdownMenuItem asChild>
                          <button type="submit" className="w-full">
                            {days === 365 ? "1 year" : `${days} days`}
                          </button>
                        </DropdownMenuItem>
                      </Form>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button asChild variant="outline">
                <Link to={`/licenses/${license.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setConfirm("regenerate")}>
                    <RefreshCw /> Regenerate key
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/licenses/export.csv?q=${encodeURIComponent(license.license_key)}`}>
                      <ArrowDownToLine /> Export as CSV
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
                    <Trash2 /> Delete licence
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        <FactStrip>
          <Fact
            label="Check result"
            help="The status a check returns now. It differs from the stored status only when the status has an expiry rule and the expiry date has passed."
            value={<StatusBadge status={reported ?? { label: effective, color: DEFAULT_COLOR }} />}
            detail={valid ? "valid: true" : "valid: false"}
            tone={valid ? "success" : "danger"}
          />
          <Fact
            label="Expires"
            value={license.expires_at ? new Date(license.expires_at).toISOString().slice(0, 10) : "Never"}
            detail={license.expires_at ? `${describeExpiry(license.expires_at)}, end of day UTC${findStatus(statuses, license.status)?.on_expiry ? "" : ". Ignored by this status"}` : "No expiry date"}
            tone={expiryTone}
          />
          <Fact
            label="Sites"
            help="Sites register automatically on their first check with a domain. Once the site limit is reached, checks from additional sites return site_limit_reached."
            value={license.max_sites === null ? `${license.sites_used ?? 0}` : `${license.sites_used ?? 0} of ${license.max_sites}`}
            detail={license.max_sites === null ? "No site limit" : (license.sites_used ?? 0) >= license.max_sites ? "Limit reached" : `${license.max_sites - (license.sites_used ?? 0)} free`}
            tone={license.max_sites !== null && (license.sites_used ?? 0) >= license.max_sites ? "warning" : "default"}
          />
          <Fact
            label="Last check"
            help="Time of the most recent check and the domain it reported."
            value={<Ago ts={license.last_check_at} empty="Never" />}
            detail={license.last_check_domain ? `From ${license.last_check_domain}, ${license.check_count} in total` : `${license.check_count} checks in total`}
            tone={valid && silent ? "warning" : "default"}
          />
        </FactStrip>

        <div className="space-y-5">
          <RouteTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Integration" },
              { id: "sites", label: "Sites", count: sites.length },
              { id: "releases", label: "Releases", count: files.length + sharedFiles.length },
              { id: "activity", label: "Activity" },
              { id: "statuses", label: "Statuses" },
            ]}
          />

          {tab === "overview" && <IntegrationTab license={license} checkUrl={checkUrl} origin={origin} statuses={statuses} signingKey={signingKey} />}

          {tab === "sites" && (
            <div className="space-y-3">
              <p className="max-w-prose text-sm text-muted-foreground">
                {formatSites(license)} in use. A site registers on its first check with a domain{latestVersion ? <>, and reports its version when it sends one. Latest release for this licence: <span className="font-mono text-foreground">{latestVersion}</span></> : ""}.
                {outdatedSites > 0 && ` ${outdatedSites} site${outdatedSites === 1 ? " is" : "s are"} behind it.`}
              </p>
              {sites.length === 0 ? (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No site has checked this licence with a domain yet.</p>
              ) : (
                <div className="rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Site</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead className="hidden lg:table-cell">Address</TableHead>
                        <TableHead className="hidden md:table-cell">First seen</TableHead>
                        <TableHead>Last check</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Checks</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sites.map((site) => (
                        <TableRow key={site.domain}>
                          <TableCell className="font-medium">{site.domain}</TableCell>
                          <TableCell>
                            {site.version ? (
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs">{site.version}</span>
                                {isOutdated(site.version, latestVersion) ? <Badge variant="warning">Update available</Badge> : latestVersion && <Badge variant="success">Up to date</Badge>}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not reported</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <IpAddress ip={site.last_ip} blocked={site.last_ip ? blockedIps.includes(site.last_ip) : false} />
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            <Ago ts={site.first_seen_at} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <Ago ts={site.last_seen_at} />
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums sm:table-cell">{site.check_count}</TableCell>
                          <TableCell className="text-right">
                            <SiteRelease domain={site.domain} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {tab === "releases" && (
            <div className="space-y-8">
              <FilesSection
                ownerLabel="licence"
                description={
                  license.app_id
                    ? "Releases and files of this licence and of its app. The licence is offered the latest release of the track that serves its current status. A track of the licence replaces the app's track for the statuses it serves, for example a custom build for this client."
                    : "Releases and files of this licence. Releases are grouped in tracks: each track serves a set of statuses, and the licence is offered the latest release of its status's track."
                }
                uploadPath={`/licenses/${license.id}/files`}
                downloadUrl={(fileId) => `${origin}/download/${license.license_key}/${fileId}`}
                license={license}
                statuses={statuses}
                files={files}
                shared={license.app_id ? { appName: license.app_name ?? "App", appHref: `/apps/${license.app_id}`, files: sharedFiles, statuses, tracks: appTracks } : null}
                configured={filesConfigured}
                tracks={tracks}
                receiving={receiving}
                githubApp={githubApp}
              />
            </div>
          )}

          {tab === "activity" && <ActivityTab licenseId={license.id} activity={activity} blockedIps={blockedIps} traffic={traffic} statuses={statuses} />}

          {tab === "statuses" &&
            (license.app_id ? (
              <p className="max-w-prose text-sm text-muted-foreground">
                This licence uses the statuses of the app{" "}
                <Link className="text-foreground underline underline-offset-2" to={`/apps/${license.app_id}?tab=statuses`}>
                  {license.app_name}
                </Link>
                , like every licence of that app. Change them on the app page. Only a standalone licence can have statuses of its own.
              </p>
            ) : (
              <StatusSection owner="licence" statuses={statuses} fallback={DEFAULT_STATUSES} custom={customStatuses} usage={statusUsage} actionPath={`/licenses/${license.id}`} inheritedFrom="the default statuses" />
            ))}
        </div>

        <ConfirmAction
          intent="regenerate"
          open={confirm === "regenerate"}
          onOpenChange={(open) => setConfirm(open ? "regenerate" : null)}
          title="Regenerate the key?"
          description="The current key, check URL and download links stop working immediately. The site will need the new key."
          confirm="Regenerate key"
        />
        <ConfirmAction
          intent="delete"
          open={confirm === "delete"}
          onOpenChange={(open) => setConfirm(open ? "delete" : null)}
          title="Delete this licence?"
          description="Its files and history are deleted too, and the check URL returns 'unknown' from now on, which a site treats as invalid. To switch a site off but keep the record, change the status instead."
          confirm="Delete licence"
        />
      </div>
    </>
  )
}

function SiteRelease({ domain }: { domain: string }) {
  const fetcher = useFetcher()
  return (
    <Button variant="ghost" size="sm" disabled={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "release-site", domain }, { method: "post" })}>
      Release
    </Button>
  )
}

function IntegrationTab({
  license,
  checkUrl,
  origin,
  statuses,
  signingKey,
}: {
  license: Route.ComponentProps["loaderData"]["license"]
  checkUrl: string
  origin: string
  statuses: ReturnType<typeof useStatusSetForLicense>
  signingKey: { publicKey: string; keyId: string }
}) {
  const example = `curl "${checkUrl}?domain=${license.last_check_domain ?? license.domains.split(",")[0]?.trim() ?? "example.com"}&version=1.0.0"`
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="space-y-4">
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Licence key <HelpTip>Identifies and authenticates this licence. Anyone holding it can check the licence and download the files it allows. Treat it as a secret.</HelpTip>
          </p>
          <CopyField value={license.license_key} />
        </div>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Check URL{" "}
            <HelpTip>
              The site calls it (GET) about every 12 hours with its domain, and its version to be told about updates. The JSON response is signed with this installation's signing key (X-Warden-Signature-Ed25519 header).
            </HelpTip>
          </p>
          <CopyField value={checkUrl} />
        </div>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Download list <HelpTip>Lists the files this licence can see, with their availability and the latest release.</HelpTip>
          </p>
          <CopyField value={`${origin}/download/${license.license_key}`} />
        </div>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Public signing key{" "}
            <HelpTip>
              Ed25519 public key of this installation, the same for every licence. Put it in the site's code: the site verifies the X-Warden-Signature-Ed25519 header of each check with it, and the
              signature of each release before installing it. It is public: it can verify signatures but not create them. Key ID {signingKey.keyId}.
            </HelpTip>
          </p>
          <CopyField value={signingKey.publicKey} />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Example request</p>
          <CodeBlock code={example} language="bash" />
          <p className="text-xs text-muted-foreground">
            Site code, signature checks and an updater: see docs/checking.md and docs/releases.md in the repository.
          </p>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Details</h2>
        <dl className="divide-y rounded-lg border bg-card text-sm">
          <Detail label="Stored status">{statusLabel(statuses, license.status)}</Detail>
          <Detail label="Allowed domains" help="Sites must send one of these as ?domain=. Subdomains match.">
            {license.domains || <span className="text-muted-foreground">Any domain</span>}
          </Detail>
          <Detail label="Site limit">{license.max_sites ?? <span className="text-muted-foreground">Unlimited</span>}</Detail>
          <Detail label="Public message" help="Returned to sites in the check response.">
            {license.message || <span className="text-muted-foreground">None</span>}
          </Detail>
          {license.external_ref && <Detail label="External reference">{license.external_ref}</Detail>}
          <Detail label="Created">
            <When ts={license.created_at} />
          </Detail>
          {license.notes && (
            <Detail label="Internal notes">
              <span className="whitespace-pre-line">{license.notes}</span>
            </Detail>
          )}
        </dl>
      </section>
    </div>
  )
}

function Detail({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        {help && <HelpTip>{help}</HelpTip>}
      </dt>
      <dd className="break-words">{children}</dd>
    </div>
  )
}

const EVENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "change", label: "Changes" },
  { id: "check", label: "Checks" },
  { id: "download", label: "Downloads" },
] as const

function ActivityTab({ licenseId, activity, blockedIps, traffic, statuses }: { licenseId: string; activity: LoaderData["activity"]; blockedIps: string[]; traffic: LoaderData["traffic"]; statuses: ReturnType<typeof useStatusSetForLicense> }) {
  const [filter, setFilter] = useState<(typeof EVENT_FILTERS)[number]["id"]>("all")
  const shown = filter === "all" ? activity : activity.filter((a) => a.event === filter)
  const checks = traffic.reduce((n, d) => n + d.valid + d.invalid, 0)
  return (
    <div className="space-y-3">
      <section className="mb-6 rounded-lg border bg-card p-4">
        <ColumnChart
          title="Licence checks, last 30 days"
          data={traffic}
          series={[
            { key: "valid", label: "Valid", color: "var(--chart-1)" },
            { key: "invalid", label: "Invalid", color: "var(--chart-2)" },
          ]}
          height={140}
          summary={<span className="tabular-nums">{checks.toLocaleString("en-GB")} checks</span>}
          viewAll={`/analytics?license=${licenseId}`}
        />
      </section>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        {EVENT_FILTERS.map((f) => {
          const count = f.id === "all" ? activity.length : activity.filter((a) => a.event === f.id).length
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn("rounded-full border px-3 py-1 text-xs transition-colors", filter === f.id ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
        <span className="ml-auto text-xs text-muted-foreground">Latest {activity.length} events. Checks older than 90 days are removed.</span>
      </div>
      <div className="rounded-lg border bg-card">
        {shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {shown.map((a) => (
              <li key={a.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2 text-sm">
                <span className="text-xs text-muted-foreground">{a.event === "check" ? "Check" : a.event === "download" ? "Download" : "Change"}</span>
                <span className="min-w-0 break-words">
                  {a.event === "check" ? (
                    <>
                      {a.domain ?? "No domain"}: <span className={cn(findStatus(statuses, a.status ?? "")?.grants_access ? "" : "text-red-700 dark:text-red-400")}>{statusLabel(statuses, a.status)}</span>
                      {a.detail && <span className="text-muted-foreground">, {a.detail.replace(/^Version /, "version ")}</span>}
                    </>
                  ) : a.event === "download" ? (
                    <>
                      {a.detail}
                      {a.domain && <span className="text-muted-foreground"> from {a.domain}</span>}
                    </>
                  ) : (
                    a.detail
                  )}
                </span>
                <span className="flex flex-col items-end gap-0.5 text-xs whitespace-nowrap text-muted-foreground">
                  <Ago ts={a.at} />
                  {a.event !== "change" && a.ip && <IpAddress ip={a.ip} blocked={blockedIps.includes(a.ip)} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
