import { useEffect, useState } from "react"
import { Link, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router"
import { Ban, Check, ShieldBan, Trash2 } from "lucide-react"
import type { Route } from "./+types/protection"
import { BlockIpDialog } from "#/components/ip-address"
import { HelpTip } from "#/components/help-tip"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { onlyTabChanged, RouteTabs, useRouteTab } from "#/components/route-tabs"
import { Ago } from "#/components/time"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { NativeSelect } from "#/components/ui/native-select"
import { Switch } from "#/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { Textarea } from "#/components/ui/textarea"
import {
  durationLabel, LIMIT_INFO, LIMIT_KEYS, MAX_NEVER_BLOCK, MAX_RULE_COUNT, RATE_TIERS, RULE_DURATIONS, RULE_INFO, RULE_KEYS, RULE_WINDOWS, windowLabel, type ProtectionSettings, type RuleKey,
} from "#/lib/protection"
import { cn } from "#/lib/utils"
import { requireAuth } from "~/server/auth.server"
import { createBlock, deleteBlock, listBlocks, readBlockForm } from "~/server/ip-blocks.server"
import { getProtection, saveProtection } from "~/server/protection.server"

export const meta: Route.MetaFunction = () => [{ title: "Protection | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const [blocks, settings] = await Promise.all([listBlocks(env), getProtection(env)])
  return { blocks, settings, now: Date.now() }
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return onlyTabChanged(args) ? false : args.defaultShouldRevalidate
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const intent = String(form.get("intent"))
  if (intent === "block") {
    const input = readBlockForm(form)
    if ("error" in input) return { error: input.error }
    const created = await createBlock(env, input)
    return "error" in created ? { error: created.error } : { ok: true as const }
  }
  if (intent === "unblock") {
    await deleteBlock(env, String(form.get("id") ?? ""))
    return { ok: true as const }
  }
  if (intent === "save-limits") {
    const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(form.get(k) ?? 0)]))
    const saved = await saveProtection(env, { limits })
    return "error" in saved ? { error: saved.error } : { ok: true as const }
  }
  if (intent === "save-rules") {
    const rules = Object.fromEntries(
      RULE_KEYS.map((k) => [k, { enabled: form.get(`${k}.enabled`) === "on", count: Number(form.get(`${k}.count`)), minutes: Number(form.get(`${k}.minutes`)), block_hours: Number(form.get(`${k}.block_hours`)) }])
    )
    const never_block = String(form.get("never_block") ?? "").split(/[\s,]+/).filter(Boolean)
    const saved = await saveProtection(env, { rules, never_block })
    return "error" in saved ? { error: saved.error } : { ok: true as const }
  }
  return { error: "Unknown action." }
}

const TABS = ["blocked", "limits", "rules"] as const

export default function Protection({ loaderData }: Route.ComponentProps) {
  const { blocks, settings, now } = loaderData
  const [tab, setTab] = useRouteTab([...TABS])
  const [adding, setAdding] = useState(false)
  const active = blocks.filter((b) => b.expires_at === null || b.expires_at > now)
  const rulesOn = RULE_KEYS.filter((k) => settings.rules[k].enabled).length

  return (
    <>
      <PageHeader crumbs={[{ label: "Protection" }]} />
      <div className="max-w-6xl space-y-6 p-4 pt-0 lg:px-6">
        <PageTitle
          title="Protection"
          description="Access control for the public check and download endpoints: IP blocklist, rate limits and blocking rules. IP blocking never applies to the dashboard or the API."
          actions={
            <Button onClick={() => setAdding(true)}>
              <Ban /> Block IP address
            </Button>
          }
        />

        <RouteTabs
          tabs={[
            { id: "blocked", label: "IP blocklist", count: active.length },
            { id: "limits", label: "Rate limits" },
            { id: "rules", label: "Blocking rules", count: rulesOn },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "blocked" && <BlockedTab blocks={blocks} now={now} onAdd={() => setAdding(true)} />}
        {tab === "limits" && <LimitsTab settings={settings} />}
        {tab === "rules" && <RulesTab settings={settings} />}
      </div>
      <BlockIpDialog open={adding} onOpenChange={setAdding} />
    </>
  )
}

type LoaderData = Route.ComponentProps["loaderData"]

function BlockedTab({ blocks, now, onAdd }: { blocks: LoaderData["blocks"]; now: number; onAdd: () => void }) {
  if (blocks.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldBan />
          </EmptyMedia>
          <EmptyTitle>No blocked IP addresses</EmptyTitle>
          <EmptyDescription>
            Block an address from a licence&apos;s activity log, its sites or{" "}
            <Link to="/analytics" className="underline underline-offset-2">
              Analytics
            </Link>
            , or let the blocking rules add it. To stop a single customer, suspend the licence or regenerate its key instead: one IP address can be shared by several sites.
          </EmptyDescription>
        </EmptyHeader>
        <Button onClick={onAdd}>
          <Ban /> Block IP address
        </Button>
      </Empty>
    )
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IP address or range</TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Blocked requests</TableHead>
              <TableHead className="hidden sm:table-cell">Last blocked</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.map((b) => {
              const expired = b.expires_at !== null && b.expires_at <= now
              return (
                <TableRow key={b.id} className={expired ? "text-muted-foreground" : undefined}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-mono text-xs">
                      {b.value}
                      {b.source === "auto" && <Badge variant="info">Rule</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added <Ago ts={b.created_at} />
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-80 md:table-cell">
                    <span className="line-clamp-2 text-sm whitespace-normal">{b.reason || <span className="text-muted-foreground">None</span>}</span>
                  </TableCell>
                  <TableCell>{expired ? <Badge variant="secondary">Expired</Badge> : b.expires_at === null ? "Never" : <Ago ts={b.expires_at} />}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.hits.toLocaleString("en-GB")}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    <Ago ts={b.last_hit_at} empty="Never" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Unblock id={b.id} label={expired ? "Remove" : "Unblock"} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Changes take effect within 30 seconds. Blocked request counts are approximate. Expired entries are deleted 30 days after expiry.</p>
    </div>
  )
}

function Unblock({ id, label }: { id: string; label: string }) {
  const fetcher = useFetcher()
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="unblock" />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={fetcher.state !== "idle"}>
        <Trash2 /> {label}
      </Button>
    </fetcher.Form>
  )
}

/** Save button with the result of the last save. */
function SaveRow({ fetcher, dirty }: { fetcher: ReturnType<typeof useFetcher<{ ok?: true; error?: string }>>; dirty: boolean }) {
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setSaved(true)
  }, [fetcher.state, fetcher.data])
  useEffect(() => {
    if (dirty) setSaved(false)
  }, [dirty])
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={fetcher.state !== "idle"}>
        Save changes
      </Button>
      {fetcher.data?.error ? (
        <p className="text-sm text-destructive">{fetcher.data.error}</p>
      ) : (
        saved &&
        !dirty && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4 text-green-600" /> Saved. Takes effect within 30 seconds.
          </p>
        )
      )}
    </div>
  )
}

function LimitsTab({ settings }: { settings: ProtectionSettings }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>()
  const [values, setValues] = useState(settings.limits)
  const dirty = LIMIT_KEYS.some((k) => values[k] !== settings.limits[k])
  return (
    <fetcher.Form method="post" className="space-y-5">
      <input type="hidden" name="intent" value="save-limits" />
      <p className="max-w-3xl text-sm text-muted-foreground">
        Requests over a limit receive <code className="text-foreground">429 Too Many Requests</code> with <code className="text-foreground">Retry-After: 60</code>. A rate-limited check returns no licence verdict, so a site
        that keeps its last valid response continues to run. Counters are maintained per Cloudflare location and are approximate. Allowlisted addresses are exempt.
      </p>
      <div className="divide-y rounded-lg border bg-card">
        {LIMIT_KEYS.map((key) => (
          <div key={key} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
            <div className="min-w-0">
              <Label htmlFor={`limit-${key}`} className="font-medium">
                {LIMIT_INFO[key].label}
              </Label>
              <p className="text-xs text-muted-foreground">
                {LIMIT_INFO[key].scope} {LIMIT_INFO[key].help}
              </p>
            </div>
            <NativeSelect id={`limit-${key}`} name={key} value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) as typeof v[typeof key] }))}>
              <option value={0}>Disabled</option>
              {RATE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier.toLocaleString("en-GB")} per minute
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      <SaveRow fetcher={fetcher} dirty={dirty} />
    </fetcher.Form>
  )
}

function RulesTab({ settings }: { settings: ProtectionSettings }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>()
  const [rules, setRules] = useState(settings.rules)
  const [neverBlock, setNeverBlock] = useState(settings.never_block.join("\n"))
  const dirty = JSON.stringify(rules) !== JSON.stringify(settings.rules) || neverBlock.trim() !== settings.never_block.join("\n")
  const update = (key: RuleKey, change: Partial<(typeof rules)[RuleKey]>) => setRules((r) => ({ ...r, [key]: { ...r[key], ...change } }))

  return (
    <fetcher.Form method="post" className="space-y-5">
      <input type="hidden" name="intent" value="save-rules" />
      <p className="max-w-3xl text-sm text-muted-foreground">
        When an address reaches a rule&apos;s threshold within the time window, it is added to the IP blocklist for the block duration, marked <span className="font-medium text-foreground">Rule</span>. Rules are
        evaluated after the response is sent and add no latency.
      </p>
      <div className="space-y-3">
        {RULE_KEYS.map((key) => {
          const rule = rules[key]
          return (
            <section key={key} className={cn("rounded-lg border bg-card p-4", !rule.enabled && "bg-muted/30")}>
              <div className="flex items-start gap-3">
                <Switch id={`${key}-enabled`} checked={rule.enabled} onCheckedChange={(enabled) => update(key, { enabled })} className="mt-0.5" aria-describedby={`${key}-help`} />
                {rule.enabled && <input type="hidden" name={`${key}.enabled`} value="on" />}
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <Label htmlFor={`${key}-enabled`} className="font-medium">
                      {RULE_INFO[key].label}
                    </Label>
                    <p id={`${key}-help`} className="text-xs text-muted-foreground">
                      {RULE_INFO[key].help}
                    </p>
                  </div>
                  <fieldset disabled={!rule.enabled} className={cn("grid gap-3 sm:grid-cols-3", !rule.enabled && "opacity-60")}>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${key}-count`} className="text-xs text-muted-foreground">
                        Threshold
                      </Label>
                      <Input
                        id={`${key}-count`}
                        name={`${key}.count`}
                        type="number"
                        min={2}
                        max={MAX_RULE_COUNT}
                        value={rule.count}
                        onChange={(e) => update(key, { count: Number(e.target.value) })}
                        className="tabular-nums"
                        aria-describedby={`${key}-unit`}
                        required
                      />
                      <p id={`${key}-unit`} className="text-xs text-muted-foreground">
                        {RULE_INFO[key].unit[0].toUpperCase() + RULE_INFO[key].unit.slice(1)}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${key}-minutes`} className="text-xs text-muted-foreground">
                        Time window
                      </Label>
                      <NativeSelect id={`${key}-minutes`} name={`${key}.minutes`} value={rule.minutes} onChange={(e) => update(key, { minutes: Number(e.target.value) })}>
                        {RULE_WINDOWS.map((m) => (
                          <option key={m} value={m}>
                            {windowLabel(m)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${key}-hours`} className="text-xs text-muted-foreground">
                        Block duration
                      </Label>
                      <NativeSelect id={`${key}-hours`} name={`${key}.block_hours`} value={rule.block_hours} onChange={(e) => update(key, { block_hours: Number(e.target.value) })}>
                        {RULE_DURATIONS.map((h) => (
                          <option key={h} value={h}>
                            {durationLabel(h)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </fieldset>
                  {/* A disabled fieldset is not submitted; its values are kept for when the rule is turned on again. */}
                  {!rule.enabled && (
                    <>
                      <input type="hidden" name={`${key}.block_hours`} value={rule.block_hours} />
                      <input type="hidden" name={`${key}.count`} value={rule.count} />
                      <input type="hidden" name={`${key}.minutes`} value={rule.minutes} />
                    </>
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <Label htmlFor="never-block" className="flex items-center gap-1.5 font-medium">
          Allowlist <HelpTip>Exempt from rate limits and blocking rules. Addresses you block manually remain blocked.</HelpTip>
        </Label>
        <p className="text-xs text-muted-foreground">One IP address or CIDR range per line, up to {MAX_NEVER_BLOCK}. For example your own servers or monitoring services.</p>
        <Textarea id="never-block" name="never_block" value={neverBlock} onChange={(e) => setNeverBlock(e.target.value)} rows={4} className="font-mono text-xs" placeholder={"198.51.100.10\n203.0.113.0/24"} />
      </section>

      <SaveRow fetcher={fetcher} dirty={dirty} />
    </fetcher.Form>
  )
}
