/** Converts a name to a URL-safe identifier: lowercase letters, digits and single hyphens. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 48 && SLUG_PATTERN.test(slug)
}

/**
 * Compares two version strings by their numeric dot-separated parts (1.10.0 > 1.9.2). A leading "v" and any
 * pre-release suffix are ignored. Returns a negative number, zero or a positive number.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, "").split(/[-+]/)[0].split(".").map((n) => Number.parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The file with the highest version among those that have one. Ties keep the first entry. */
export function latestVersioned<T extends { version: string }>(files: T[]): T | null {
  let best: T | null = null
  for (const file of files) {
    if (!file.version.trim()) continue
    if (!best || compareVersions(file.version, best.version) > 0) best = file
  }
  return best
}
