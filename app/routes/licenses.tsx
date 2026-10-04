import { useState } from "react"
import { Link } from "react-router"
import { KeyRound, Plus, Search } from "lucide-react"
import type { Route } from "./+types/licenses"
import { PageHeader } from "#/components/page-header"
import { LicenseStatusBadge } from "#/components/status-badge"
import { Ago } from "#/components/time"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { NativeSelect } from "#/components/ui/native-select"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { effectiveStatus, STATUSES, STATUS_LABEL } from "#/lib/license"
import { requireAuth } from "~/server/auth.server"
import { listLicenses } from "~/server/licenses.server"

export const meta: Route.MetaFunction = () => [{ title: "Licences | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return { licenses: await listLicenses(env) }
}

export default function Licenses({ loaderData }: Route.ComponentProps) {
  const { licenses } = loaderData
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")

  const shown = licenses.filter((l) => {
    if (status !== "all" && effectiveStatus(l) !== status) return false
    const q = query.trim().toLowerCase()
    return !q || `${l.name} ${l.client} ${l.license_key} ${l.domains}`.toLowerCase().includes(q)
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
              <EmptyDescription>Create one for a client site. You get a key and a check URL to put in that site&apos;s code.</EmptyDescription>
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
                <Input className="pl-9" placeholder="Search name, client, key or domain" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-44">
                <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
                  <option value="all">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Licence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Ends</TableHead>
                    <TableHead className="hidden sm:table-cell">Last check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Link to={`/licenses/${l.id}`} className="font-medium hover:underline">
                          {l.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{l.client || l.license_key}</div>
                      </TableCell>
                      <TableCell>
                        <LicenseStatusBadge license={l} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{l.expires_at ? new Date(l.expires_at).toISOString().slice(0, 10) : <span className="text-muted-foreground">no end date</span>}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Ago ts={l.last_check_at} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No licence matches.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
