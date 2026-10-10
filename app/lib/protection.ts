/** Protection settings: rate limits and automatic blocking rules. Pure and client-safe. */

import { formatRange, parseRange } from "./ip"

/**
 * Rate limits, in requests per minute per address (or per key). Each value has a Workers rate limiting binding of
 * its own in wrangler.jsonc (RATE_LIMIT_<n>); the setting picks which one counts. 0 turns the limit off.
 */
export const RATE_TIERS = [30, 60, 120, 300, 600, 1200] as const
export type RateTier = 0 | (typeof RATE_TIERS)[number]

export const LIMIT_KEYS = ["check_ip", "check_key", "download_ip", "api_key"] as const
export type LimitKey = (typeof LIMIT_KEYS)[number]

export const LIMIT_INFO: Record<LimitKey, { label: string; per: string; help: string }> = {
  check_ip: { label: "Checks per address", per: "from one IP address", help: "A site checks about twice a day, but many sites on one shared host use the same address." },
  check_key: { label: "Checks per licence key", per: "for one licence key, from any address", help: "Stops a leaked key being called from many places at once." },
  download_ip: { label: "Downloads per address", per: "from one IP address", help: "Downloads are larger; a site downloads an update once." },
  api_key: { label: "API requests per API key", per: "with one API key", help: "Your own tools (payment webhooks, scripts). Over the limit the API answers 429." },
}

export const RULE_KEYS = ["unknown_keys", "refused_checks", "many_licenses", "rate_limited"] as const
export type RuleKey = (typeof RULE_KEYS)[number]

export type Rule = {
  enabled: boolean
  /** How many events within the window trigger the block. */
  count: number
  /** The window, in minutes. */
  minutes: number
  /** How long the automatic block lasts, in hours; 0 = until removed. */
  block_hours: number
}

export const RULE_INFO: Record<RuleKey, { label: string; event: string; help: string }> = {
  unknown_keys: {
    label: "Guessing licence keys",
    event: "checks or downloads with a key that does not exist",
    help: "A real site always sends a real key. Many unknown keys from one address mean someone is trying keys.",
  },
  refused_checks: {
    label: "Refused checks",
    event: "refused checks (suspended or expired licence, wrong domain, site limit reached)",
    help: "Careful: a customer site with a suspended licence that checks on every page view can trigger this, and a shared host blocks every site on it.",
  },
  many_licenses: {
    label: "Many licences from one address",
    event: "different licences checked",
    help: "One address checking many licences can be key sharing, or simply a host with many of your customers. Set the number above your largest legitimate host.",
  },
  rate_limited: {
    label: "Staying over a rate limit",
    event: "minutes with requests over a rate limit",
    help: "Each address counts at most once a minute, so this means an address kept going over a limit for that many minutes.",
  },
}

/** Window lengths offered, in minutes. Events older than a day are deleted, so no window is longer. */
export const RULE_WINDOWS = [5, 10, 30, 60, 360, 1440] as const
/** Block lengths offered, in hours; 0 = until removed. */
export const RULE_DURATIONS = [1, 6, 24, 168, 720, 0] as const
export const MAX_RULE_COUNT = 10_000
export const MAX_NEVER_BLOCK = 50

export function durationLabel(hours: number): string {
  if (hours === 0) return "until removed"
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`
  const days = hours / 24
  return `${days} day${days === 1 ? "" : "s"}`
}

export function windowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  const hours = minutes / 60
  return `${hours} hour${hours === 1 ? "" : "s"}`
}

export type ProtectionSettings = {
  limits: Record<LimitKey, RateTier>
  rules: Record<RuleKey, Rule>
  /** Addresses and ranges never rate limited and never blocked by a rule (your own servers, monitoring). */
  never_block: string[]
}

export const DEFAULT_PROTECTION: ProtectionSettings = {
  limits: { check_ip: 120, check_key: 60, download_ip: 30, api_key: 600 },
  rules: {
    unknown_keys: { enabled: true, count: 20, minutes: 10, block_hours: 24 },
    refused_checks: { enabled: false, count: 50, minutes: 10, block_hours: 24 },
    many_licenses: { enabled: false, count: 25, minutes: 60, block_hours: 24 },
    rate_limited: { enabled: true, count: 5, minutes: 10, block_hours: 1 },
  },
  never_block: [],
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Validates settings sent by the dashboard or the API. Missing parts keep their `base` value, so a partial update
 * changes only what it names. Returns the complete settings or the first error.
 */
export function readProtection(input: unknown, base: ProtectionSettings = DEFAULT_PROTECTION): { settings: ProtectionSettings } | { error: string } {
  if (!isObject(input)) return { error: "Send an object with limits, rules and never_block." }
  const settings: ProtectionSettings = structuredClone(base)

  if (input.limits !== undefined) {
    if (!isObject(input.limits)) return { error: "limits must be an object." }
    for (const [key, value] of Object.entries(input.limits)) {
      if (!(LIMIT_KEYS as readonly string[]).includes(key)) return { error: `Unknown limit "${key}". Limits: ${LIMIT_KEYS.join(", ")}.` }
      if (value !== 0 && !(RATE_TIERS as readonly unknown[]).includes(value)) return { error: `limits.${key} must be 0 (off) or one of ${RATE_TIERS.join(", ")}.` }
      settings.limits[key as LimitKey] = value as RateTier
    }
  }

  if (input.rules !== undefined) {
    if (!isObject(input.rules)) return { error: "rules must be an object." }
    for (const [key, value] of Object.entries(input.rules)) {
      if (!(RULE_KEYS as readonly string[]).includes(key)) return { error: `Unknown rule "${key}". Rules: ${RULE_KEYS.join(", ")}.` }
      if (!isObject(value)) return { error: `rules.${key} must be an object.` }
      const rule = settings.rules[key as RuleKey]
      if (value.enabled !== undefined) {
        if (typeof value.enabled !== "boolean") return { error: `rules.${key}.enabled must be true or false.` }
        rule.enabled = value.enabled
      }
      if (value.count !== undefined) {
        if (!Number.isInteger(value.count) || (value.count as number) < 2 || (value.count as number) > MAX_RULE_COUNT) return { error: `rules.${key}.count must be a whole number from 2 to ${MAX_RULE_COUNT}.` }
        rule.count = value.count as number
      }
      if (value.minutes !== undefined) {
        if (!(RULE_WINDOWS as readonly unknown[]).includes(value.minutes)) return { error: `rules.${key}.minutes must be one of ${RULE_WINDOWS.join(", ")}.` }
        rule.minutes = value.minutes as number
      }
      if (value.block_hours !== undefined) {
        if (!(RULE_DURATIONS as readonly unknown[]).includes(value.block_hours)) return { error: `rules.${key}.block_hours must be one of ${RULE_DURATIONS.join(", ")} (0 = until removed).` }
        rule.block_hours = value.block_hours as number
      }
    }
  }

  if (input.never_block !== undefined) {
    if (!Array.isArray(input.never_block) || input.never_block.some((v) => typeof v !== "string")) return { error: "never_block must be a list of addresses or ranges." }
    if (input.never_block.length > MAX_NEVER_BLOCK) return { error: `never_block holds at most ${MAX_NEVER_BLOCK} entries.` }
    const list: string[] = []
    for (const raw of input.never_block as string[]) {
      if (!raw.trim()) continue
      const parsed = parseRange(raw)
      if ("error" in parsed) return { error: `${raw.trim()}: ${parsed.error}` }
      const value = formatRange(parsed.range)
      if (!list.includes(value)) list.push(value)
    }
    settings.never_block = list
  }
  return { settings }
}
