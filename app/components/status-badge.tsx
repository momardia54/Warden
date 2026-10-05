import { useStatusSetForLicense } from "#/components/status-context"
import { DEFAULT_COLOR, effectiveStatusKey, findStatus, type StatusDef } from "#/lib/statuses"

/** A badge for one status, drawn in the status's own colour. */
export function StatusBadge({ status }: { status: Pick<StatusDef, "label" | "color"> }) {
  return (
    <span
      className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{
        backgroundColor: `color-mix(in srgb, ${status.color} 16%, transparent)`,
        // Blend a little of the text colour in so any chosen colour stays readable in both themes.
        color: `color-mix(in srgb, ${status.color} 78%, var(--foreground))`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.label}
    </span>
  )
}

/** Shows the status sites see for a licence. An expiry rule that has triggered is applied, for example Active becoming Expired. */
export function LicenseStatusBadge({ license }: { license: { id: string; status: string; expires_at: number | null; app_id: string | null } }) {
  const set = useStatusSetForLicense(license)
  const key = effectiveStatusKey(license, set)
  const def = findStatus(set, key)
  return <StatusBadge status={def ?? { label: key, color: DEFAULT_COLOR }} />
}
