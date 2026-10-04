import { STATUSES, STATUS_HINT, STATUS_LABEL, type Status } from "#/lib/license"

/** A row of checkboxes, one per licence status. */
export function StatusPicker({ value, onChange, disabled }: { value: Status[]; onChange: (next: Status[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Licence statuses">
      {STATUSES.map((status) => (
        <label key={status} className="flex items-center gap-1.5 text-sm" title={STATUS_HINT[status]}>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.includes(status)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? STATUSES.filter((s) => s === status || value.includes(s)) : value.filter((s) => s !== status))}
          />
          {STATUS_LABEL[status]}
        </label>
      ))}
    </div>
  )
}
