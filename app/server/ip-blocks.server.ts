import { BLOCK_DURATIONS, formatRange, parseIp, parseRange, rangeContains, type IpRange } from "../lib/ip"
import { newId } from "./util.server"

export type IpBlock = {
  id: string
  value: string
  reason: string
  created_at: number
  expires_at: number | null
  hits: number
  last_hit_at: number | null
  /** manual, or auto when a protection rule created it. */
  source: "manual" | "auto"
}

export const MAX_REASON_LENGTH = 200

/**
 * The blocklist is read on every check and download, so each Worker instance keeps a copy for a short time. A new
 * or removed block applies at once on the instance that made the change and within this delay everywhere else.
 */
const CACHE_MS = 30_000
let cache: { at: number; blocks: (IpBlock & { range: IpRange })[] } | null = null

export function clearBlockCache() {
  cache = null
}

export async function listBlocks(env: Env): Promise<IpBlock[]> {
  return (await env.DB.prepare("SELECT * FROM ip_blocks ORDER BY created_at DESC").all<IpBlock>()).results
}

async function activeBlocks(env: Env, now: number) {
  if (!cache || now - cache.at > CACHE_MS) {
    const rows = (await env.DB.prepare("SELECT * FROM ip_blocks WHERE expires_at IS NULL OR expires_at > ?").bind(now).all<IpBlock>()).results
    const blocks = rows.flatMap((row) => {
      const parsed = parseRange(row.value)
      return "range" in parsed ? [{ ...row, range: parsed.range }] : []
    })
    cache = { at: now, blocks }
  }
  return cache.blocks.filter((b) => b.expires_at === null || b.expires_at > now)
}

/** The block that covers an address, if any. */
export async function findBlock(env: Env, ip: string | null, now = Date.now()): Promise<IpBlock | null> {
  const parsed = ip ? parseIp(ip) : null
  if (!parsed) return null
  return (await activeBlocks(env, now)).find((b) => rangeContains(b.range, parsed)) ?? null
}

export type BlockInput = { value: string; reason: string; expires_at: number | null; source?: IpBlock["source"] }

export async function createBlock(env: Env, input: BlockInput, now = Date.now()): Promise<{ block: IpBlock } | { error: string; code: "invalid" | "exists" }> {
  const parsed = parseRange(input.value)
  if ("error" in parsed) return { error: parsed.error, code: "invalid" }
  const value = formatRange(parsed.range)
  const reason = input.reason.trim().slice(0, MAX_REASON_LENGTH)
  if (input.expires_at !== null && input.expires_at <= now) return { error: "The end of the block must be in the future.", code: "invalid" }
  const existing = await env.DB.prepare("SELECT * FROM ip_blocks WHERE value = ?").bind(value).first<IpBlock>()
  if (existing) {
    if (existing.expires_at === null || existing.expires_at > now) return { error: `${value} is already blocked.`, code: "exists" }
    // An expired block of the same address is renewed rather than duplicated.
    const source = input.source ?? "manual"
    await env.DB.prepare("UPDATE ip_blocks SET reason = ?, created_at = ?, expires_at = ?, source = ? WHERE id = ?").bind(reason, now, input.expires_at, source, existing.id).run()
    clearBlockCache()
    return { block: { ...existing, reason, created_at: now, expires_at: input.expires_at, source } }
  }
  const block: IpBlock = { id: newId("blk"), value, reason, created_at: now, expires_at: input.expires_at, hits: 0, last_hit_at: null, source: input.source ?? "manual" }
  await env.DB.prepare("INSERT INTO ip_blocks (id, value, reason, created_at, expires_at, source) VALUES (?, ?, ?, ?, ?, ?)").bind(block.id, value, reason, now, block.expires_at, block.source).run()
  clearBlockCache()
  return { block }
}

export async function deleteBlock(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM ip_blocks WHERE id = ?").bind(id).run()
  clearBlockCache()
  return (res.meta.changes ?? 0) > 0
}

/** Reads the block form of the dashboard (also used by the activity and analytics menus). */
export function readBlockForm(form: FormData, now = Date.now()): BlockInput | { error: string } {
  const value = String(form.get("value") ?? "")
  const days = Number(form.get("days") ?? 0)
  if (!(BLOCK_DURATIONS as readonly number[]).includes(days)) return { error: "Choose how long the block lasts." }
  return { value, reason: String(form.get("reason") ?? ""), expires_at: days === 0 ? null : now + days * 86_400_000 }
}

/** Blocks whose end passed more than 30 days ago are deleted by the daily job. */
export async function pruneBlocks(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at < ?").bind(now - 30 * 86_400_000).run()
}

/** The addresses among `ips` that an active block covers. */
export async function blockedAmong(env: Env, ips: (string | null)[], now = Date.now()): Promise<string[]> {
  const unique = [...new Set(ips.filter((ip): ip is string => Boolean(ip)))]
  const flags = await Promise.all(unique.map(async (ip) => (await findBlock(env, ip, now)) !== null))
  return unique.filter((_, i) => flags[i])
}
