/**
 * On workers.dev the first hostname label is the Worker's name, which `wrangler ... --name` needs.
 * Custom domains and preview URLs give no reliable hint, so they return null.
 */
export function workerNameFromHost(hostname: string): string | null {
  const host = hostname.toLowerCase()
  if (!host.endsWith(".workers.dev")) return null
  const label = host.split(".")[0]
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(label) ? label : null
}
