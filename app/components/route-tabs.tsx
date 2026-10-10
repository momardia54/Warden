import { useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router"
import { cn } from "#/lib/utils"

export type RouteTab = { id: string; label: string; /** A count shown next to the label. Hidden when null or undefined. */ count?: number | null }

/**
 * The selected tab of a page, kept in the address (?tab=) so it survives a reload and can be linked. The first tab is
 * the default and leaves the address clean.
 */
export function useRouteTab(ids: string[]): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get("tab") ?? ""
  const current = ids.includes(raw) ? raw : ids[0]
  const select = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id === ids[0]) next.delete("tab")
        else next.set("tab", id)
        return next
      },
      { replace: true, preventScrollReset: true }
    )
  return [current, select]
}

/** For a page's shouldRevalidate: switching tabs only changes ?tab=, which needs no new data. */
export function onlyTabChanged({ currentUrl, nextUrl, formMethod }: Pick<ShouldRevalidateFunctionArgs, "currentUrl" | "nextUrl" | "formMethod">): boolean {
  if (formMethod || currentUrl.pathname !== nextUrl.pathname) return false
  const strip = (url: URL) => {
    const params = new URLSearchParams(url.search)
    params.delete("tab")
    params.sort()
    return params.toString()
  }
  return strip(currentUrl) === strip(nextUrl)
}

/** A row of tabs drawn as an underlined bar. The panels are rendered by the page for the selected tab. */
export function RouteTabs({ tabs, value, onChange }: { tabs: RouteTab[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" aria-orientation="horizontal" className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
              e.preventDefault()
              const at = tabs.findIndex((t) => t.id === value)
              const next = tabs[(at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
              onChange(next.id)
              document.getElementById(`tab-${next.id}`)?.focus()
            }}
            className={cn(
              "relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
              active ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count !== null && tab.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground tabular-nums">{tab.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
