/** Traffic analytics: the shapes shared by the server, the dashboard and the API. */

export const DAY_MS = 86_400_000

/** The periods offered, in days. Checks older than 90 days are pruned, so no period reaches further back. */
export const TRAFFIC_RANGES = [7, 30, 90] as const
export type TrafficRange = (typeof TRAFFIC_RANGES)[number]
export const DEFAULT_RANGE: TrafficRange = 30

export function readRange(raw: string | null | undefined): TrafficRange {
  const n = Number(raw)
  return (TRAFFIC_RANGES as readonly number[]).includes(n) ? (n as TrafficRange) : DEFAULT_RANGE
}

/** The traffic of one UTC calendar day. */
export type TrafficDay = {
  /** YYYY-MM-DD, UTC. */
  date: string
  /** Checks answered with a status that lets the site run. */
  valid: number
  /** Checks answered with a status that does not (suspended, expired, wrong domain, site limit reached…). */
  refused: number
  /** Distinct sites (licence and domain) registered by a check that day. */
  sites: number
  /** Files downloaded (refused downloads are not counted). */
  downloads: number
}

export type TrafficTotals = { checks: number; valid: number; refused: number; sites: number; new_sites: number; downloads: number; refused_downloads: number }

export type RefusalReason = { key: string; label: string; checks: number }
export type LicenseTraffic = { id: string; name: string; app_name: string | null; checks: number; refused: number; last_check_at: number | null }
export type FileTraffic = { name: string; downloads: number }

export type TrafficReport = {
  days: number
  /** First millisecond of the period (start of a UTC day) and the moment the report was built. */
  from: number
  to: number
  series: TrafficDay[]
  totals: TrafficTotals
  refusals: RefusalReason[]
  licenses: LicenseTraffic[]
  files: FileTraffic[]
}

/** Start of the UTC day that contains `at`. */
export const startOfUtcDay = (at: number) => Math.floor(at / DAY_MS) * DAY_MS

/** The first millisecond of a period of `days` calendar days ending today (UTC). */
export const periodStart = (days: number, now: number) => startOfUtcDay(now) - (days - 1) * DAY_MS

export const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10)

/** An empty series covering the period, one entry per day, oldest first. */
export function emptySeries(days: number, now: number): TrafficDay[] {
  const from = periodStart(days, now)
  return Array.from({ length: days }, (_, i) => ({ date: isoDay(from + i * DAY_MS), valid: 0, refused: 0, sites: 0, downloads: 0 }))
}

/** "12.9K" style numbers for axes and summaries. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${+(n / 1_000_000).toFixed(1)}M`
}
