import { Link } from "react-router"
import { LicenseStatusBadge } from "#/components/status-badge"
import { Ago } from "#/components/time"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"

export type LicenseRowData = {
  id: string
  name: string
  customer_name: string
  customer_email: string
  license_key: string
  status: string
  expires_at: number | null
  max_sites: number | null
  sites_used?: number
  last_check_at: number | null
  app_id: string | null
  app_name?: string | null
}

export function formatSites(license: Pick<LicenseRowData, "max_sites" | "sites_used">): string {
  const used = license.sites_used ?? 0
  return license.max_sites === null ? `${used} (no limit)` : `${used} of ${license.max_sites}`
}

/** A table of licences. The App column is shown for lists that mix apps. */
export function LicensesTable({ licenses, showApp = true, empty = "No licence matches." }: { licenses: LicenseRowData[]; showApp?: boolean; empty?: string }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Licence</TableHead>
            {showApp && <TableHead className="hidden lg:table-cell">App</TableHead>}
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Expires</TableHead>
            <TableHead className="hidden md:table-cell">Sites</TableHead>
            <TableHead className="hidden sm:table-cell">Last check</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {licenses.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <Link to={`/licenses/${l.id}`} className="font-medium hover:underline">
                  {l.name}
                </Link>
                <div className="text-xs text-muted-foreground">{l.customer_name || l.customer_email || l.license_key}</div>
              </TableCell>
              {showApp && (
                <TableCell className="hidden lg:table-cell">
                  {l.app_id ? (
                    <Link to={`/apps/${l.app_id}`} className="hover:underline">
                      {l.app_name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Standalone</span>
                  )}
                </TableCell>
              )}
              <TableCell>
                <LicenseStatusBadge license={l} />
              </TableCell>
              <TableCell className="hidden md:table-cell">{l.expires_at ? new Date(l.expires_at).toISOString().slice(0, 10) : <span className="text-muted-foreground">Never</span>}</TableCell>
              <TableCell className="hidden md:table-cell">{formatSites(l)}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <Ago ts={l.last_check_at} />
              </TableCell>
            </TableRow>
          ))}
          {licenses.length === 0 && (
            <TableRow>
              <TableCell colSpan={showApp ? 6 : 5} className="py-8 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
