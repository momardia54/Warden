/** IP addresses and ranges (CIDR) for the blocklist. Pure and client-safe. */

export type ParsedIp = { version: 4 | 6; value: bigint }
export type IpRange = { version: 4 | 6; base: bigint; prefix: number }

/** Durations offered when blocking, in days; 0 = until removed. */
export const BLOCK_DURATIONS = [1, 7, 30, 0] as const
export const BLOCK_DURATION_LABELS: Record<(typeof BLOCK_DURATIONS)[number], string> = { 1: "1 day", 7: "7 days", 30: "30 days", 0: "Until removed" }

/** The narrowest ranges allowed: a block of a whole /8 (IPv4) or /16 (IPv6) is already very large. */
export const MIN_PREFIX = { 4: 8, 6: 16 } as const
const BITS = { 4: 32, 6: 128 } as const

function parseV4(text: string): bigint | null {
  const parts = text.split(".")
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith("0"))) return null
    value = (value << 8n) | BigInt(part)
  }
  return value
}

function parseV6(text: string): bigint | null {
  let head = text
  let tailV4: bigint | null = null
  // An IPv4 tail (::ffff:203.0.113.5) stands for the last two groups.
  const lastColon = text.lastIndexOf(":")
  if (text.includes(".")) {
    tailV4 = parseV4(text.slice(lastColon + 1))
    if (tailV4 === null) return null
    head = `${text.slice(0, lastColon + 1)}0:0`
  }
  const halves = head.split("::")
  if (halves.length > 2) return null
  const groups = (s: string) => (s === "" ? [] : s.split(":"))
  const left = groups(halves[0])
  const right = halves.length === 2 ? groups(halves[1]) : []
  const missing = 8 - left.length - right.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right]
  let value = 0n
  for (const group of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  if (tailV4 !== null) value = (value & ~0xffffffffn) | tailV4
  return value
}

/** Parses an IPv4 or IPv6 address. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is read as IPv4. */
export function parseIp(raw: string): ParsedIp | null {
  const text = raw.trim()
  if (!text || text.length > 45) return null
  if (!text.includes(":")) {
    const v4 = parseV4(text)
    return v4 === null ? null : { version: 4, value: v4 }
  }
  const v6 = parseV6(text)
  if (v6 === null) return null
  if (v6 >> 32n === 0xffffn) return { version: 4, value: v6 & 0xffffffffn }
  return { version: 6, value: v6 }
}

function formatV4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".")
}

/** IPv6 in its short form (RFC 5952): lower case, the longest run of zero groups as "::". */
function formatV6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 0xffffn))
  let bestStart = -1
  let bestLength = 1
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLength) [bestStart, bestLength] = [i, j - i]
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestStart < 0) return hex.join(":")
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`
}

export function formatIp(ip: ParsedIp): string {
  return ip.version === 4 ? formatV4(ip.value) : formatV6(ip.value)
}

/** The canonical text of an address, or null if it is not one. */
export function normalizeIp(raw: string | null | undefined): string | null {
  const ip = raw ? parseIp(raw) : null
  return ip ? formatIp(ip) : null
}

/**
 * Reads "203.0.113.5", "203.0.113.0/24" or "2001:db8::/32". The base is masked to the prefix, so "203.0.113.9/24"
 * becomes 203.0.113.0/24. Prefixes wider than MIN_PREFIX are refused.
 */
export function parseRange(raw: string): { range: IpRange } | { error: string } {
  const [address, prefixText, extra] = raw.trim().split("/")
  if (extra !== undefined) return { error: "Enter an IP address or a range such as 203.0.113.0/24." }
  const ip = parseIp(address ?? "")
  if (!ip) return { error: "Enter an IP address (IPv4 or IPv6), or a range such as 203.0.113.0/24." }
  const bits = BITS[ip.version]
  const prefix = prefixText === undefined ? bits : /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : NaN
  if (!Number.isInteger(prefix) || prefix > bits) return { error: `The range size must be a number from ${MIN_PREFIX[ip.version]} to ${bits}.` }
  if (prefix < MIN_PREFIX[ip.version]) return { error: `A range wider than /${MIN_PREFIX[ip.version]} could block a large part of the internet.` }
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n)
  return { range: { version: ip.version, base: ip.value & mask, prefix } }
}

/** "203.0.113.5" for a single address, "203.0.113.0/24" for a range. */
export function formatRange(range: IpRange): string {
  const address = formatIp({ version: range.version, value: range.base })
  return range.prefix === BITS[range.version] ? address : `${address}/${range.prefix}`
}

export function rangeContains(range: IpRange, ip: ParsedIp): boolean {
  if (range.version !== ip.version) return false
  const shift = BigInt(BITS[ip.version] - range.prefix)
  return ip.value >> shift === range.base >> shift
}
