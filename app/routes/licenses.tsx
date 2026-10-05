import { useState } from "react"
import { Link } from "react-router"
import { KeyRound, Plus, Search } from "lucide-react"
import type { Route } from "./+types/licenses"
import { PageHeader } from "#/components/page-header"
import { LicensesTable } from "#/components/licenses-table"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { NativeSelect } from "#/components/ui/native-select"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { statusSetForLicense, useAllStatuses, useStatusSets } from "#/components/status-context"
import { effectiveStatusKey } from "#/lib/statuses"
import { requireAuth } from "~/server/auth.server"
import { listApps } from "~/server/apps.server"
import { queryLicenses } from "~/server/licenses.server"

/** The dashboard list shows the newest licences up to this number. The API pages through all of them. */
const LIST_LIMIT = 1000

export const meta: Route.MetaFunction = () => [{ title: "Licences | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const [licenses, apps] = await Promise.all([queryLicenses(env, { limit: LIST_LIMIT + 1 }), listApps(env)])
  return { licenses: licenses.slice(0, LIST_LIMIT), truncated: licenses.length > LIST_LIMIT, apps: apps.map((a) => ({ id: a.id, name: a.name })) }
}

export default function Licenses({ loaderData }: Route.ComponentProps) {
  const { licenses, apps, truncated } = loaderData
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [appFilter, setAppFilter] = useState("all")
  const sets = useStatusSets()
  const allStatuses = useAllStatuses()

  const shown = licenses.filter((l) => {
    if (status !== "all" && effectiveStatusKey(l, statusSetForLicense(sets, l)) !== status) return false
    if (appFilter === "none" ? l.app_id !== null : appFilter !== "all" && l.app_id !== appFilter) return false
    const q = query.trim().toLowerCase()
    return !q || `${l.name} ${l.customer_name} ${l.customer_email} ${l.license_key} ${l.domains} ${l.app_name ?? ""}`.toLowerCase().includes(q)
  })

  return (
    <>
      <PageHeader crumbs={[{ label: "Licences" }]} />
      <div className="space-y-4 p-4 pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Licences</h1>
          <Button asChild>
            <Link to="/licenses/new">
              <Plus /> New licence
            </Link>
          </Button>
        </div>

        {licenses.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound />
              </EmptyMedia>
              <EmptyTitle>No licences yet</EmptyTitle>
              <EmptyDescription>Create one for a customer&apos;s site. You get a licence key and a check URL to put in that site&apos;s code.</EmptyDescription>
            </EmptyHeader>
            <Button asChild>
              <Link to="/licenses/new">
                <Plus /> New licence
              </Link>
            </Button>
          </Empty>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1 sm:max-w-sm">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-50" />
                <Input className="pl-9" placeholder="Search name, customer, key, domain or app" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-48">
                <NativeSelect value={appFilter} onChange={(e) => setAppFilter(e.target.value)} aria-label="Filter by app">
                  <option value="all">All apps</option>
                  <option value="none">Standalone only</option>
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="w-44">
                <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
                  <option value="all">All statuses</option>
                  {allStatuses.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <LicensesTable licenses={shown} />
            {truncated && <p className="text-xs text-muted-foreground">Showing the newest {LIST_LIMIT} licences. Use the API to list all of them.</p>}
          </>
        )}
      </div>
    </>
  )
}
