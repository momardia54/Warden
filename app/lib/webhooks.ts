import { SILENT_AFTER_DAYS } from "./views"

/**
 * Outgoing webhooks: the events an endpoint can receive. Shared by the server, the dashboard and the docs, so the
 * event names and their meaning are defined once.
 */
export const WEBHOOK_EVENTS = [
  { type: "license.created", label: "Licence created", description: "A licence was created, in the dashboard or through the API." },
  { type: "license.updated", label: "Licence edited", description: "Fields of a licence were changed. data.changes lists what changed." },
  { type: "license.status_changed", label: "Status changed", description: "The stored status was changed. data.previous_status is the status before." },
  { type: "license.renewed", label: "Licence renewed", description: "The expiry date was extended. data.previous_expires_at is the date before." },
  {
    type: "license.grace_period_started",
    label: "Grace period started",
    description: "The expiry date has passed and the licence is in its grace period: still valid until data.license.grace_ends_at.",
  },
  { type: "license.expired", label: "Licence expired", description: "The expiry rule of the licence's status took effect: checks now report the status it points to." },
  { type: "license.silent", label: "No recent check", description: `No site has checked this valid licence for ${SILENT_AFTER_DAYS} days.` },
  { type: "license.deleted", label: "Licence deleted", description: "A licence was deleted. data.license is the licence as it was." },
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["type"]

/** Sent only by "Send test event", to the endpoint being tested. */
export const TEST_EVENT = "webhook.test"

export const EVENT_TYPES: readonly string[] = WEBHOOK_EVENTS.map((e) => e.type)

export const isEventType = (value: unknown): value is WebhookEventType => typeof value === "string" && EVENT_TYPES.includes(value)

export const MAX_WEBHOOKS = 10

/** Delays before each retry of a failed delivery. A delivery is attempted once plus once per delay, then marked failed. */
export const RETRY_DELAYS_MS = [10 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 24 * 3_600_000]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

/** Deliveries are kept this long, then deleted by the daily clean-up. */
export const DELIVERY_RETENTION_DAYS = 30

/**
 * Checks an endpoint address: HTTPS, or HTTP only for a local address (for testing with a local receiver). Returns the
 * normalised URL or an error message.
 */
export function validateWebhookUrl(raw: string): { url: string } | { error: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { error: "Enter the full address of the endpoint, starting with https://." }
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { error: "The endpoint must use https:// (http:// is accepted only for localhost)." }
  if (url.username || url.password) return { error: "Put credentials in the endpoint's own configuration, not in the address." }
  if (url.href.length > 500) return { error: "The address must be 500 characters or fewer." }
  return { url: url.href }
}
