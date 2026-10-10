import { useState } from "react"
import { Link, useNavigation, useSearchParams } from "react-router"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import type { Route } from "./+types/analytics"
import { ColumnChart } from "#/components/column-chart"
import { IpAddress } from "#/components/ip-address"
import { Fact, FactStrip } from "#/components/fact-strip"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { Ago } from "#/components/time"
import { NativeSelect } from "#/components/ui/native-select"
import { compactNumber, LIST_LIMIT, LIST_PREVIEW, readRange, TRAFFIC_RANGES } from "#/lib/analytics"
import { cn } from "#/lib/utils"
import { trafficReport, type TrafficScope } from "~/server/analytics.server"
import { requireAuth } from "~/server/auth.server"
import { listApps } from "~/server/apps.server"
import { getLicense } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "Analytics | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const url = new URL(request.url)
  const days = readRange(url.searchParams.get("range"))
  const apps = (await listApps(env)).map((a) => ({ id: a.id, name: a.name }))
  const appParam = url.searchParams.get("app") ?? ""
  const app = appParam === "none" ? "none" : (apps.find((a) => a.id === appParam)?.id ?? "")
  // A licence (from "View all" on a licence's chart) takes precedence over the app filter.
  const licenseParam = url.searchParams.get("license")
  const license = licenseParam ? await getLicense(env, licenseParam) : null
  const scope: TrafficScope = license ? { license: license.id } : app === "none" ? { standalone: true } : app ? { app } : {}
  return { report: await trafficReport(env, scope, days), apps, app, license: license ? { id: license.id, name: license.name } : null }
}

const percent = (part: number, whole: number) => (whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`)

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const { report, apps, app, license } = loaderData
  const { totals, series } = report
  const [, setParams] = useSearchParams()
  const loading = useNavigation().state === "loading"
  // Ranked lists show their first rows; "View all" shows every row the report holds.
  const [expanded, setExpanded] = useState({ licenses: false, files: false, ips: false })
  const toggle = (list: keyof typeof expanded) => setExpanded((e) => ({ ...e, [list]: !e[list] }))
  const preview = <T,>(rows: T[], list: keyof typeof expanded) => (expanded[list] ? rows : rows.slice(0, LIST_PREVIEW))

  function update(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true, preventScrollReset: true }
    )
  }

  return (
    <>
      <PageHeader crumbs={[{ label: "Analytics" }]} />
      <div className="max-w-6xl space-y-6 p-4 pt-0 lg:px-6">
        <PageTitle title="Analytics" description="Checks from your customers' sites and downloads of your files, by day (UTC)." />

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Period">
            {TRAFFIC_RANGES.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={report.days === days}
                onClick={() => update("range", days === 30 ? "" : String(days))}
                className={cn("rounded px-3 py-1 text-sm transition-colors", report.days === days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {days} days
              </button>
            ))}
          </div>
          {license ? (
            <span className="inline-flex items-center gap-1 rounded-md border bg-muted/50 py-1 pr-1 pl-3 text-sm">
              Licence:{" "}
              <Link to={`/licenses/${license.id}`} className="font-medium hover:underline">
                {license.name}
              </Link>
              <button type="button" onClick={() => update("license", "")} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Show every licence">
                <X className="size-3.5" />
              </button>
            </span>
          ) : (
            <div className="w-52">
              <NativeSelect value={app} onChange={(e) => update("app", e.target.value)} aria-label="Filter by app">
                <option value="">All apps and licences</option>
                <option value="none">Standalone licences</option>
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>

        {/* While another period loads, the current figures stay in place, dimmed. */}
        <div className={cn("space-y-8 transition-opacity", loading && "opacity-60")}>
          <FactStrip>
            <Fact label="Checks" value={totals.checks.toLocaleString("en-GB")} detail={`${percent(totals.valid, totals.checks)} valid`} help="Every call of a check URL in the period, whatever the answer." />
            <Fact
              label="Refused checks"
              value={totals.refused.toLocaleString("en-GB")}
              detail={`${percent(totals.refused, totals.checks)} of checks`}
              tone={totals.refused > 0 ? "warning" : "default"}
              help="Checks answered as not valid: a status that does not let the site run (suspended, expired…), a domain that is not allowed, or a full site limit."
            />
            <Fact label="Active sites" value={totals.sites.toLocaleString("en-GB")} detail={`${totals.new_sites} new in the period`} help="Distinct sites (a licence on a domain) that checked in during the period. Sites refused for their domain or the site limit are not counted." />
            <Fact
              label="Downloads"
              value={totals.downloads.toLocaleString("en-GB")}
              detail={totals.refused_downloads > 0 ? `${totals.refused_downloads} refused` : "None refused"}
              help="Files downloaded through download links. A refused download is a request for a file the licence's status does not release."
            />
          </FactStrip>

          <section className="rounded-lg border bg-card p-4">
            <ColumnChart
              title="Checks per day"
              description="Valid answers let the site run; refused ones do not."
              data={series}
              series={[
                { key: "valid", label: "Valid", color: "var(--chart-1)" },
                { key: "refused", label: "Refused", color: "var(--chart-2)" },
              ]}
              height={220}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border bg-card p-4">
              <ColumnChart title="Active sites per day" description="Distinct sites that checked in." data={series} series={[{ key: "sites", label: "Sites", color: "var(--chart-1)" }]} height={160} />
            </section>
            <section className="rounded-lg border bg-card p-4">
              <ColumnChart title="Downloads per day" description="Files downloaded through download links." data={series} series={[{ key: "downloads", label: "Downloads", color: "var(--chart-1)" }]} height={160} />
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="font-semibold">Why checks were refused</h2>
              {report.refusals.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No check was refused in this period.</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {report.refusals.map((r) => (
                    <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm">
                      <span className="truncate">{r.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {r.checks.toLocaleString("en-GB")} <span className="text-xs">({percent(r.checks, totals.refused)})</span>
                      </span>
                      <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full" style={{ width: percent(r.checks, totals.refused), background: "var(--chart-2)" }} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <ListHeading title="Most checked licences" count={report.licenses.length} expanded={expanded.licenses} onToggle={() => toggle("licenses")} />
              {report.licenses.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No licence was checked in this period.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Licence</th>
                        <th className="w-20 px-3 py-2 text-right font-medium">Checks</th>
                        <th className="w-24 px-4 py-2 text-right font-medium">Refused</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview(report.licenses, "licenses").map((l) => (
                        <tr key={l.id}>
                          <td className="max-w-0 px-4 py-2">
                            <Link to={`/licenses/${l.id}?tab=activity`} className="block truncate font-medium hover:underline">
                              {l.name}
                            </Link>
                            <span className="block truncate text-xs text-muted-foreground">
                              {l.app_name ?? "Standalone"}, last check <Ago ts={l.last_check_at} />
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{compactNumber(l.checks)}</td>
                          <td className={cn("px-4 py-2 text-right tabular-nums", l.refused > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{compactNumber(l.refused)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="space-y-3">
            <ListHeading title="Most downloaded files" count={report.files.length} expanded={expanded.files} onToggle={() => toggle("files")} />
            {report.files.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No file was downloaded in this period.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {preview(report.files, "files").map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="truncate font-mono text-xs">{f.name}</span>
                    <span className="text-muted-foreground tabular-nums">{f.downloads.toLocaleString("en-GB")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="space-y-3">
              <ListHeading title="Top addresses" count={report.ips.length} expanded={expanded.ips} onToggle={() => toggle("ips")} />
              {report.ips.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No address recorded in this period. Addresses are recorded since this version of Warden.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Address</th>
                        <th className="px-3 py-2 text-right font-medium">Checks</th>
                        <th className="px-3 py-2 text-right font-medium">Refused</th>
                        <th className="px-3 py-2 text-right font-medium">Downloads</th>
                        <th className="px-4 py-2 text-right font-medium">Licences</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y tabular-nums">
                      {preview(report.ips, "ips").map((row) => (
                        <tr key={row.ip}>
                          <td className="max-w-0 min-w-40 px-4 py-2">
                            <IpAddress ip={row.ip} blocked={row.blocked} />
                          </td>
                          <td className="px-3 py-2 text-right">{compactNumber(row.checks)}</td>
                          <td className={cn("px-3 py-2 text-right", row.refused > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{compactNumber(row.refused)}</td>
                          <td className="px-3 py-2 text-right">{compactNumber(row.downloads)}</td>
                          <td className="px-4 py-2 text-right">{row.licenses}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">An address that checks many licences, or gets many refusals, is worth a look. Click an address to block it.</p>
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold">Refused before any licence was read</h2>
              {totals.blocked === null || totals.rate_limited === null ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">These requests belong to no licence, so they are counted for the whole installation only. Clear the filter to see them.</p>
              ) : (
                <dl className="divide-y rounded-lg border bg-card text-sm">
                  <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <dt>
                      <Link to="/protection" className="hover:underline">
                        From a blocked address
                      </Link>
                    </dt>
                    <dd className="tabular-nums">{totals.blocked.toLocaleString("en-GB")}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <dt>Over a rate limit</dt>
                    <dd className="tabular-nums">{totals.rate_limited.toLocaleString("en-GB")}</dd>
                  </div>
                </dl>
              )}
              <p className="text-xs text-muted-foreground">Approximate counts of checks and downloads refused with 403 (blocked) or 429 (too many requests).</p>
            </section>
          </div>

          <p className="text-xs text-muted-foreground">
            Checks are kept for 90 days. A check counts as valid if its status lets sites run under the statuses in use today.
          </p>
        </div>
      </div>
    </>
  )
}

/** A list's title with "View all (n)" when it holds more rows than the preview shows. */
function ListHeading({ title, count, expanded, onToggle }: { title: string; count: number; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-semibold">{title}</h2>
      {count > LIST_PREVIEW && (
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted">
          {expanded ? (
            <>
              Show fewer <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              View all {count >= LIST_LIMIT ? `top ${LIST_LIMIT}` : count} <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  )
}
