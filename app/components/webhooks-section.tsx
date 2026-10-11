import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { History, MoreHorizontal, Pencil, Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react"
import { ConfirmAction } from "#/components/confirm-action"
import { FieldLabel } from "#/components/help-tip"
import { Ago } from "#/components/time"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { Switch } from "#/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { MAX_WEBHOOKS, TEST_EVENT, WEBHOOK_EVENTS } from "#/lib/webhooks"

export type DeliveryView = {
  id: string
  event: string
  /** Name of the licence the event is about, if any. */
  license: string | null
  state: "pending" | "sending" | "delivered" | "failed"
  attempts: number
  last_status: number | null
  last_error: string
  last_attempt_at: number | null
  created_at: number
  next_attempt_at: number
  delivered_at: number | null
}

export type WebhookView = {
  id: string
  url: string
  description: string
  events: string[]
  enabled: boolean
  pending: number
  failed: number
  deliveries: DeliveryView[]
}

type ActionResult = { ok?: boolean; error?: string; test?: DeliveryView }

const eventLabel = (type: string) => (type === TEST_EVENT ? "Test event" : (WEBHOOK_EVENTS.find((e) => e.type === type)?.label ?? type))

/** What went wrong with the last attempt: the HTTP status the endpoint answered with, or why there was no answer. */
const describeFailure = (d: Pick<DeliveryView, "last_status" | "last_error">) => [d.last_status ? `HTTP ${d.last_status}.` : "", d.last_error].filter(Boolean).join(" ")

const STATE_BADGE: Record<DeliveryView["state"], { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  delivered: { label: "Delivered", variant: "success" },
  pending: { label: "Waiting for retry", variant: "warning" },
  sending: { label: "Sending", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
}

/** Outgoing webhooks on the Integrations page: endpoints, their events and their recent deliveries. */
export function WebhooksSection({ webhooks }: { webhooks: WebhookView[] }) {
  const [editing, setEditing] = useState<WebhookView | "new" | null>(null)
  const [deleting, setDeleting] = useState<WebhookView | null>(null)
  const [history, setHistory] = useState<string | null>(null)

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <WebhookIcon className="mt-0.5 size-5" />
          <div className="space-y-1">
            <h2 className="font-medium">Webhooks</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Warden calls these addresses when something happens to a licence: created, renewed, its status changed, its grace period started, it expired, or no site has checked it recently. Use
              them to update your billing or support tools. Each request is signed with this installation's signing key.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setEditing("new")} disabled={webhooks.length >= MAX_WEBHOOKS}>
          <Plus /> Add webhook
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No webhooks yet. Add one with the address that should receive the events.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {webhooks.map((w) => (
            <li key={w.id} className="space-y-3 p-4">
              <WebhookRow webhook={w} onEdit={() => setEditing(w)} onDelete={() => setDeleting(w)} showHistory={history === w.id} onToggleHistory={() => setHistory(history === w.id ? null : w.id)} />
            </li>
          ))}
        </ul>
      )}

      <WebhookDialog target={editing} onClose={() => setEditing(null)} />
      <ConfirmAction
        intent="delete-webhook"
        fields={{ id: deleting?.id ?? "" }}
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this webhook?"
        description={`Warden stops sending events to ${deleting?.url ?? "this address"}, and its delivery history is deleted.`}
        confirm="Delete"
      />
    </section>
  )
}

function WebhookRow({ webhook: w, onEdit, onDelete, showHistory, onToggleHistory }: { webhook: WebhookView; onEdit: () => void; onDelete: () => void; showHistory: boolean; onToggleHistory: () => void }) {
  const toggle = useFetcher<ActionResult>()
  const test = useFetcher<ActionResult>()
  const enabled = toggle.formData ? toggle.formData.get("enabled") === "true" : w.enabled
  const last = w.deliveries.reduce<DeliveryView | null>((latest, d) => (d.last_attempt_at && (!latest || d.last_attempt_at > latest.last_attempt_at!) ? d : latest), null)
  const tested = test.state === "idle" ? test.data : undefined

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <code className="truncate font-mono text-sm">{w.url}</code>
            {!enabled && <Badge variant="secondary">Paused</Badge>}
            {w.failed > 0 && <Badge variant="destructive">{w.failed} failed</Badge>}
            {w.pending > 0 && <Badge variant="warning">{w.pending} waiting for retry</Badge>}
          </div>
          {w.description && <p className="text-sm text-muted-foreground">{w.description}</p>}
          <div className="flex flex-wrap gap-1.5">
            {w.events.map((e) => (
              <Badge key={e} variant="outline" className="font-normal">
                {eventLabel(e)}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {last ? (
              last.state === "delivered" ? (
                <>
                  Last delivery <Ago ts={last.last_attempt_at} />: HTTP {last.last_status}.
                </>
              ) : (
                <>
                  Last attempt <Ago ts={last.last_attempt_at} /> failed: {describeFailure(last)}
                </>
              )
            ) : (
              "No deliveries yet."
            )}
          </p>
          {tested?.test && (
            <p className={tested.test.state === "delivered" ? "text-xs text-green-700 dark:text-green-400" : "text-xs text-destructive"}>
              Test event {tested.test.state === "delivered" ? `delivered: HTTP ${tested.test.last_status}.` : `not delivered: ${describeFailure(tested.test)}`}
            </p>
          )}
          {tested?.error && <p className="text-xs text-destructive">{tested.error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            aria-label={enabled ? "Pause this webhook" : "Resume this webhook"}
            title={enabled ? "Active: click to pause" : "Paused: click to resume"}
            onCheckedChange={(next) => toggle.submit({ intent: "toggle-webhook", id: w.id, enabled: String(next) }, { method: "post" })}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Webhook actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={test.state !== "idle"} onSelect={() => test.submit({ intent: "test-webhook", id: w.id }, { method: "post" })}>
                <Send /> Send test event
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleHistory}>
                <History /> {showHistory ? "Hide deliveries" : "Recent deliveries"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showHistory && <Deliveries webhookId={w.id} deliveries={w.deliveries} />}
    </>
  )
}

function Deliveries({ webhookId, deliveries }: { webhookId: string; deliveries: DeliveryView[] }) {
  if (deliveries.length === 0) return <p className="text-sm text-muted-foreground">No deliveries in the last 30 days.</p>
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="align-top">
                <div className="whitespace-nowrap">{eventLabel(d.event)}</div>
                <div className="text-xs text-muted-foreground">
                  {d.license ? `${d.license}, ` : ""}
                  <Ago ts={d.created_at} />
                </div>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={STATE_BADGE[d.state].variant}>{STATE_BADGE[d.state].label}</Badge>
                {d.state === "pending" && d.attempts > 0 && (
                  <div className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
                    next attempt <Ago ts={d.next_attempt_at} />
                  </div>
                )}
              </TableCell>
              <TableCell className="min-w-40 align-top text-xs whitespace-normal text-muted-foreground">
                {d.attempts === 0 ? "Not sent yet" : `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}. ${d.state === "delivered" ? `HTTP ${d.last_status}.` : describeFailure(d)}`}
              </TableCell>
              <TableCell className="align-top">{(d.state === "failed" || (d.state === "pending" && d.attempts > 0)) && <RetryButton webhookId={webhookId} deliveryId={d.id} />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function RetryButton({ webhookId, deliveryId }: { webhookId: string; deliveryId: string }) {
  const retry = useFetcher<ActionResult>()
  return (
    <Button type="button" variant="outline" size="sm" disabled={retry.state !== "idle"} onClick={() => retry.submit({ intent: "retry-delivery", id: webhookId, delivery: deliveryId }, { method: "post" })}>
      Retry
    </Button>
  )
}

function WebhookDialog({ target, onClose }: { target: WebhookView | "new" | null; onClose: () => void }) {
  const save = useFetcher<ActionResult>()
  const editing = target !== null && target !== "new" ? target : null
  const [url, setUrl] = useState("")
  const [description, setDescription] = useState("")
  const [events, setEvents] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (target === null) return
    setUrl(editing?.url ?? "")
    setDescription(editing?.description ?? "")
    setEvents(editing?.events ?? [])
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  useEffect(() => {
    if (submitted && save.state === "idle" && save.data?.ok) onClose()
  }, [submitted, save.state, save.data, onClose])

  const busy = save.state !== "idle"
  const submit = () => {
    setSubmitted(true)
    const form = new FormData()
    form.set("intent", editing ? "update-webhook" : "create-webhook")
    if (editing) form.set("id", editing.id)
    form.set("url", url)
    form.set("description", description)
    for (const e of events) form.append("events", e)
    save.submit(form, { method: "post" })
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          // Focus the address, not the first help icon (which would open its tooltip).
          e.preventDefault()
          document.getElementById("webhook-url")?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? "Edit webhook" : "Add webhook"}</DialogTitle>
          <DialogDescription>Warden sends a POST request with a JSON body to this address for each event you choose, and retries for about a day if it does not answer with a 2xx status.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="webhook-url" help="The full address of the endpoint, starting with https://. http:// is accepted only for localhost, for testing. Redirects are not followed.">
              Endpoint address
            </FieldLabel>
            <Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://billing.harborstudio.com/hooks/warden" disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="webhook-description" help="For your reference, for example the tool the endpoint belongs to.">
              Description
            </FieldLabel>
            <Input id="webhook-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Billing system" disabled={busy} />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Events</legend>
            {WEBHOOK_EVENTS.map((e) => (
              <label key={e.type} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={events.includes(e.type)}
                  disabled={busy}
                  onChange={(change) => setEvents(change.target.checked ? [...events, e.type] : events.filter((x) => x !== e.type))}
                />
                <span>
                  {e.label} <code className="text-xs text-muted-foreground">{e.type}</code>
                  <span className="block text-xs text-muted-foreground">{e.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {submitted && save.state === "idle" && save.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{save.data.error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !url.trim() || events.length === 0}>
            {editing ? "Save" : "Add webhook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
