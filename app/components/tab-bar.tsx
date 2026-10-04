import { cn } from "#/lib/utils"

export type TabItem = { id: string; label: string; /** A small count or dot, for example how many things are switched on in that tab. */ badge?: number | string | null }

/**
 * A row of tabs. It only picks which panel is shown: the panels themselves stay in the page (hidden), so
 * every field of every tab is still submitted with the form and keeps what was typed.
 */
export function TabBar({ tabs, value, onChange, className }: { tabs: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm", className)}>
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
              e.preventDefault()
              const at = tabs.findIndex((t) => t.id === value)
              const next = tabs[(at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
              onChange(next.id)
              document.getElementById(`tab-${next.id}`)?.focus()
            }}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 whitespace-nowrap transition-colors", active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {tab.label}
            {tab.badge !== null && tab.badge !== undefined && tab.badge !== 0 && tab.badge !== "" && (
              <span className="rounded-full bg-primary/15 px-1.5 text-xs leading-5 text-foreground">{tab.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
