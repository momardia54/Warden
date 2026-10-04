import { Link } from "react-router"
import type { Route } from "./+types/overview"
import { PageHeader } from "#/components/page-header"
import { StatCard } from "#/components/stat-card"
import { Ago } from "#/components/time"
import { Button } from "#/components/ui/button"
import { StatusBadge } from "#/components/status-badge"
import { useAllStatuses, useStatusLabel } from "#/components/status-context"
import { requireAuth } from "~/server/auth.server"
import { overviewStats, recentChecks } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "Overview | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const [stats, checks] = await Promise.all([overviewStats(env), recentChecks(env)])
  return { stats, checks }
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { stats, checks } = loaderData
  const statusLabel = useStatusLabel()
  const allStatuses = useAllStatuses()
  const byStatus = Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1])
  return (
    <>
      <PageHeader crumbs={[{ label: "Overview" }]} />
      <div className="space-y-6 p-4 pt-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="In force" value={stats.inForce} hint={`of ${stats.total} licences`} help="Licences whose current status lets the site run, and whose expiry rule has not triggered." />
          <StatCard title="Not in force" value={stats.notInForce} help="Licences that sites currently see as not valid, for example suspended, disabled or expired ones." />
          <StatCard title="Expiring within 14 days" value={stats.endingSoon} help="Licences in force whose expiry date is within the next 14 days. Extend or renew them before they expire." />
          <StatCard title="No check in 3+ days" value={stats.silent} help="Licences in force whose site has not called the check URL for 3 days. The site may be offline, or the check may have been removed from its code." />
        </div>

        {byStatus.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold">By status</h2>
            <div className="flex flex-wrap gap-2">
              {byStatus.map(([key, count]) => {
                const def = allStatuses.find((s) => s.key === key)
                return (
                  <span key={key} className="flex items-center gap-1.5 text-sm">
                    <StatusBadge status={def ?? { label: key, tone: "neutral" }} />
                    <span className="text-muted-foreground">{count}</span>
                  </span>
                )
              })}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-semibold">Recent checks</h2>
          <div className="rounded-lg border">
            {checks.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No site has called a check URL yet.</p>
            ) : (
              <ul className="divide-y">
                {checks.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <Link to={`/licenses/${c.license_id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {c.domain ?? "no domain"} · {statusLabel(c.status)} · <Ago ts={c.at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <Button asChild variant="outline">
          <Link to="/licenses">All licences</Link>
        </Button>
      </div>
    </>
  )
}
