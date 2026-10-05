import { createContext, useContext } from "react"
import { DEFAULT_STATUSES, type StatusDef, type StatusSet } from "#/lib/statuses"

/** Every customised set of statuses. Provided by the dashboard layout so any component can look up labels and colours. */
export type StatusSets = { byApp: Record<string, StatusSet>; byLicense: Record<string, StatusSet> }

const StatusContext = createContext<StatusSets>({ byApp: {}, byLicense: {} })

export const StatusProvider = StatusContext.Provider

export function useStatusSets(): StatusSets {
  return useContext(StatusContext)
}

/** The statuses of an app: its own, or the built-in defaults. */
export function useStatusSetForApp(appId: string | null): StatusSet {
  const sets = useStatusSets()
  return (appId && sets.byApp[appId]) || DEFAULT_STATUSES
}

/** The statuses that apply to a licence: its own, else its app's, else the built-in defaults. */
export function useStatusSetForLicense(license: { id: string; app_id: string | null }): StatusSet {
  const sets = useStatusSets()
  return sets.byLicense[license.id] ?? (license.app_id && sets.byApp[license.app_id]) ?? DEFAULT_STATUSES
}

/** The same lookup as a plain function, for use inside loops and callbacks. */
export function statusSetForLicense(sets: StatusSets, license: { id: string; app_id: string | null }): StatusSet {
  return sets.byLicense[license.id] ?? (license.app_id && sets.byApp[license.app_id]) ?? DEFAULT_STATUSES
}

/** Every distinct status across all sets, by key, for filters that span apps and licences. The defaults win on duplicate keys. */
export function useAllStatuses(): StatusDef[] {
  const sets = useStatusSets()
  const seen = new Map<string, StatusDef>()
  for (const set of [DEFAULT_STATUSES, ...Object.values(sets.byApp), ...Object.values(sets.byLicense)]) for (const s of set) if (!seen.has(s.key)) seen.set(s.key, s)
  return [...seen.values()]
}

/** Returns a function that turns a status key into its label, looking in every set. Unknown keys are shown as they are. */
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
