import { Link } from "react-router"
import type { Route } from "./+types/overview"
import { PageHeader } from "#/components/page-header"
import { StatCard } from "#/components/stat-card"
import { Ago } from "#/components/time"
import { Button } from "#/components/ui/button"
import { checkResultLabel } from "#/lib/license"
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
  return (
    <>
      <PageHeader crumbs={[{ label: "Overview" }]} />
      <div className="space-y-6 p-4 pt-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Active" value={stats.counts.active} hint={`of ${stats.total} licences`} help="Licences currently in the Active status and not past their expiry date." />
          <StatCard title="Suspended or disabled" value={stats.counts.suspended + stats.counts.disabled} help="Licences that sites currently see as not valid because you suspended or disabled them." />
          <StatCard title="Expiring within 14 days" value={stats.endingSoon} help="Active licences whose expiry date is within the next 14 days. Extend or renew them before they expire." />
          <StatCard title="No check in 3+ days" value={stats.silent} help="Active licences whose site has not called the check URL for 3 days. The site may be offline, or the check may have been removed from its code." />
        </div>

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
                      {c.domain ?? "no domain"} · {checkResultLabel(c.status)} · <Ago ts={c.at} />
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
