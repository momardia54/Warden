import type { Route } from "./+types/search"
import { requireAuth } from "~/server/auth.server"
import { listApps } from "~/server/apps.server"
import { searchLicenses } from "~/server/licenses.server"

/** Quick search for the dashboard's search dialog: licences (including by registered site) and apps. Returns JSON. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100)
  if (!q) return { q, licenses: [], apps: [] }
  const needle = q.toLowerCase()
  const [licenses, apps] = await Promise.all([searchLicenses(env, q), listApps(env)])
  return {
    q,
    licenses,
    apps: apps.filter((a) => `${a.name} ${a.slug} ${a.description}`.toLowerCase().includes(needle)).slice(0, 5).map((a) => ({ id: a.id, name: a.name, slug: a.slug, licenses: a.licenses })),
  }
}
