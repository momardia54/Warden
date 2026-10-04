import { AlertCircle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react"
import { Badge } from "#/components/ui/badge"
import { useStatusSet } from "#/components/status-context"
import { effectiveStatusKey, findStatus, type StatusDef, type Tone } from "#/lib/statuses"

const ICON = { success: CheckCircle2, warning: AlertCircle, danger: XCircle, info: Info, neutral: CircleDashed }
const VARIANT: Record<Tone, "success" | "warning" | "destructive" | "info" | "outline"> = { success: "success", warning: "warning", danger: "destructive", info: "info", neutral: "outline" }

/** A badge for one status definition. */
export function StatusBadge({ status }: { status: Pick<StatusDef, "label" | "tone"> }) {
  const Icon = ICON[status.tone]
  return (
    <Badge variant={VARIANT[status.tone]}>
      <Icon /> {status.label}
    </Badge>
  )
}

/** Shows the status sites see for a licence. An expiry rule that has triggered is applied, for example Active becoming Expired. */
export function LicenseStatusBadge({ license }: { license: { status: string; expires_at: number | null; app_id: string | null } }) {
  const set = useStatusSet(license.app_id)
  const key = effectiveStatusKey(license, set)
  const def = findStatus(set, key)
  return <StatusBadge status={def ?? { label: key, tone: "neutral" }} />
}
