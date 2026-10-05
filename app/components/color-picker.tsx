import { Check } from "lucide-react"
import { Input } from "#/components/ui/input"
import { COLOR_PRESETS, isColor } from "#/lib/statuses"
import { cn } from "#/lib/utils"

/** Chooses any colour, with a row of presets for the common ones. The value is #rrggbb. */
export function ColorPicker({ value, onChange, id }: { value: string; onChange: (color: string) => void; id?: string }) {
  const valid = isColor(value)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Preset colours">
        {COLOR_PRESETS.map((preset) => {
          const selected = value.toLowerCase() === preset.value
          return (
            <button
              key={preset.value}
              type="button"
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={selected}
              onClick={() => onChange(preset.value)}
              className={cn("flex size-6 items-center justify-center rounded-full border border-black/10 transition-shadow dark:border-white/20", selected && "ring-2 ring-ring ring-offset-2 ring-offset-background")}
              style={{ backgroundColor: preset.value }}
            >
              {selected && <Check className="size-3.5 text-white" />}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a colour"
          value={valid ? value.toLowerCase() : "#6b7280"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} placeholder="#16a34a" className="w-32 font-mono" aria-invalid={!valid} />
        {!valid && <span className="text-xs text-destructive">Use a hex colour such as #16a34a</span>}
      </div>
    </div>
  )
}
