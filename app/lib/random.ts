const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/**
 * A random token of letters and digits, safe in URLs and headers. Uses the platform's secure random
 * source and rejects values that would make some characters more likely than others.
 */
export function generateSecret(length = 40, random: Crypto = globalThis.crypto): string {
  const limit = 256 - (256 % ALPHABET.length)
  let out = ""
  while (out.length < length) {
    const bytes = random.getRandomValues(new Uint8Array(length * 2))
    for (const byte of bytes) {
      if (byte >= limit) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === length) break
    }
  }
  return out
}
