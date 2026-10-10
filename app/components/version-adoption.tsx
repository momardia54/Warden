import { HelpTip } from "#/components/help-tip"
import { cn } from "#/lib/utils"

type Versions = { latest_version: string | null; sites: number; outdated: number; data: { version: string | null; sites: number; outdated: boolean }[] }

/** The colour of a version's share: current versions in the foreground colour, older versions amber, unknown ones muted. */
function tone(row: Versions["data"][number]) {
  if (row.version === null) return { bar: "bg-muted-foreground/25", dot: "bg-muted-foreground/40" }
  if (row.outdated) return { bar: "bg-amber-500", dot: "bg-amber-500" }
  return { bar: "bg-foreground", dot: "bg-foreground" }
}

/** How the sites of an app are spread over versions, from the versions they report with their checks. */
export function VersionAdoption({ versions }: { versions: Versions }) {
  const { data, sites, outdated, latest_version: latest } = versions
  const current = data.filter((r) => r.version !== null && !r.outdated).reduce((n, r) => n + r.sites, 0)
  const pct = (n: number) => (sites === 0 ? 0 : Math.round((n / sites) * 100))
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          Versions in use{" "}
          <HelpTip>Built from the version each site sends with its check (?version=). A site that never sent one counts as not reported.</HelpTip>
        </h3>
        <p className="text-sm text-muted-foreground tabular-nums">
          {latest ? (
            <>
              {pct(current)}% on {latest} or newer, {outdated} site{outdated === 1 ? "" : "s"} behind
            </>
          ) : (
            "No stable release yet"
          )}
        </p>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={data.map((r) => `${r.version ?? "not reported"}: ${r.sites}`).join(", ")}>
        {data.map((row) => (
          <div key={row.version ?? "none"} className={cn("h-full border-r border-background last:border-r-0", tone(row).bar)} style={{ width: `${(row.sites / sites) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {data.map((row) => (
          <li key={row.version ?? "none"} className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", tone(row).dot)} />
            <span className={cn(row.version ? "font-mono text-xs" : "text-xs text-muted-foreground")}>{row.version ?? "Not reported"}</span>
            <span className="text-muted-foreground tabular-nums">
              {row.sites} site{row.sites === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
