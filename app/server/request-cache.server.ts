/**
 * Per-request memoisation. A dashboard page is several nested loaders (layout, form, page) that all
 * need the session and the form row; without this each one asks D1 again, and every D1 query is a network hop.
 *
 * The cache is keyed by the per-request `env` object created in the Worker entry, so it can never leak
 * between requests. Anything that reads data an action may have just changed is only cached on GET/HEAD,
 * so a no-JavaScript form post never renders stale values.
 */
type Entry = { values: Map<string, Promise<unknown>>; readOnly: boolean }
const caches = new WeakMap<object, Entry>()

export function initRequestCache(env: object, request: Request) {
  caches.set(env, { values: new Map(), readOnly: request.method === "GET" || request.method === "HEAD" })
}

export function memo<T>(env: object, key: string, load: () => Promise<T>, opts: { onlyWhenReadOnly?: boolean } = {}): Promise<T> {
  const entry = caches.get(env)
  if (!entry || (opts.onlyWhenReadOnly && !entry.readOnly)) return load()
  let hit = entry.values.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = load().catch((error) => {
      entry.values.delete(key)
      throw error
    })
    entry.values.set(key, hit)
  }
  return hit
}
