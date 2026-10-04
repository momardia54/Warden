import { CheckCircle2, CircleDashed, Clock, PauseCircle, XCircle } from "lucide-react"
import { Badge } from "#/components/ui/badge"
import { effectiveStatus, STATUS_LABEL, type Status } from "#/lib/license"

const ICON = { pending: CircleDashed, active: CheckCircle2, suspended: PauseCircle, disabled: XCircle, expired: Clock }
const VARIANT = { pending: "outline", active: "success", suspended: "secondary", disabled: "destructive", expired: "destructive" } as const

/** Shows the effective status: an active licence past its end date reads "Expired". */
export function LicenseStatusBadge({ license }: { license: { status: string; expires_at: number | null } }) {
  const status: Status = effectiveStatus(license)
  const Icon = ICON[status]
  return (
    <Badge variant={VARIANT[status]}>
      <Icon /> {STATUS_LABEL[status]}
    </Badge>
  )
}
