import { createContext, useContext } from "react"
import { DEFAULT_STATUSES, findStatus, type StatusDef, type StatusSet } from "#/lib/statuses"

/** Every status set of the installation. Provided by the dashboard layout so any component can look up labels and colours. */
export type StatusSets = { default: StatusSet; byApp: Record<string, StatusSet> }

const StatusContext = createContext<StatusSets>({ default: DEFAULT_STATUSES, byApp: {} })

export const StatusProvider = StatusContext.Provider

export function useStatusSets(): StatusSets {
  return useContext(StatusContext)
}

/** The status set that applies to licences of an app (or to standalone licences when appId is null). */
export function useStatusSet(appId: string | null): StatusSet {
  const sets = useStatusSets()
  return (appId && sets.byApp[appId]) || sets.default
}

/** Every distinct status across all sets, by key, for filters that span apps. The default set wins on duplicate keys. */
export function useAllStatuses(): StatusDef[] {
  const sets = useStatusSets()
  const seen = new Map<string, StatusDef>()
  for (const set of [sets.default, ...Object.values(sets.byApp)]) for (const s of set) if (!seen.has(s.key)) seen.set(s.key, s)
  return [...seen.values()]
}

export function useFindStatus(appId: string | null, key: string): StatusDef | undefined {
  return findStatus(useStatusSet(appId), key)
}

/** Returns a function that turns a status key into its label, looking in every status set. Unknown keys are shown as they are. */
export function useStatusLabel(): (key: string | null) => string {
  const all = useAllStatuses()
  return (key) => {
    if (!key) return ""
    if (key === "domain_mismatch") return "Wrong domain"
    if (key === "unknown") return "Unknown key"
    if (key === "site_limit_reached") return "Site limit reached"
    return all.find((s) => s.key === key)?.label ?? key
  }
}
