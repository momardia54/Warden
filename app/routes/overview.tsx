import { Link } from "react-router"
import type { Route } from "./+types/overview"
import { PageHeader } from "#/components/page-header"
import { StatCard } from "#/components/stat-card"
import { Ago } from "#/components/time"
import { Button } from "#/components/ui/button"
import { answerLabel } from "#/lib/license"
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
          <StatCard title="Active" value={stats.counts.active} hint={`of ${stats.total}`} />
          <StatCard title="Suspended or disabled" value={stats.counts.suspended + stats.counts.disabled} />
          <StatCard title="Ending in 14 days" value={stats.endingSoon} />
          <StatCard title="Not checked for 3+ days" value={stats.silent} hint="active licences" />
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold">Latest checks</h2>
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
                      {c.domain ?? "no domain"} · {answerLabel(c.status)} · <Ago ts={c.at} />
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
