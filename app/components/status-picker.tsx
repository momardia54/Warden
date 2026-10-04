import type { StatusSet } from "#/lib/statuses"

/** A row of checkboxes, one per status of the set. Selected keys are returned in the order of the set. */
export function StatusPicker({ statuses, value, onChange, disabled }: { statuses: StatusSet; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Licence statuses">
      {statuses.map((status) => (
        <label key={status.key} className="flex items-center gap-1.5 text-sm" title={status.description}>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.includes(status.key)}
            disabled={disabled}
            onChange={(e) => onChange(statuses.filter((s) => (s.key === status.key ? e.target.checked : value.includes(s.key))).map((s) => s.key))}
          />
          {status.label}
        </label>
      ))}
    </div>
  )
}
