import { useEffect, useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { Check, Copy, ExternalLink, GitBranch, MoreHorizontal, Pause, Play, RefreshCw, Settings2, Tag, Unplug, Webhook } from "lucide-react"
import { ConfirmAction } from "#/components/confirm-action"
import { FieldLabel, HelpTip } from "#/components/help-tip"
import { StatusPicker } from "#/components/status-picker"
import { Ago } from "#/components/time"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { NativeSelect } from "#/components/ui/native-select"
import { defaultReleaseStatuses } from "#/lib/files"
import { IMPORT_STATE_LABELS, packageFileName, packageFolderError, PROVIDER_INFO, PROVIDERS, TRIGGER_INFO, TRIGGERS, type ImportState, type ProviderKey, type TriggerKey } from "#/lib/sources"
import { describeStatusKeys, type StatusSet } from "#/lib/statuses"

/** The connected repository, as the loader sends it (without the access token). */
export type SourceView = {
  id: string
  provider: ProviderKey
  repository: string
  trigger: TriggerKey
  package_folder: string
  status_keys: string[]
  check_domain: boolean
  has_token: boolean
  enabled: boolean
  webhook_url: string
  webhook_secret: string
  last_delivery_at: number | null
}

export type ImportView = {
  id: string
  ref: string
  version: string
  commit_sha: string
  state: ImportState
  detail: string
  started_at: number
  finished_at: number | null
}

type ActionResult = { ok?: true; error?: string }

const STATE_BADGE: Record<ImportState, "success" | "secondary" | "warning" | "destructive" | "info"> = {
  pending: "info",
  imported: "success",
  skipped: "secondary",
  failed: "destructive",
}

const FOLDER_HELP =
  "The top-level folder inside the published zip. Archives from GitHub are wrapped in a folder named after the commit; Warden renames it to this name, so every release installs into the same folder. For a WordPress theme or plugin, use its slug."

/**
 * The repository connected to an app or a licence. New tags are downloaded, repacked and published as releases.
 * Posts its intents to the current route (save-source, delete-source, regenerate-source-secret, import-tag, retry-import).
 */
export function ReleaseSource({ source, imports, statuses, ownerLabel }: { source: SourceView | null; imports: ImportView[]; statuses: StatusSet; ownerLabel: "app" | "licence" }) {
  const [editing, setEditing] = useState(false)
  const [setup, setSetup] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const action = useFetcher<ActionResult>()
  const revalidator = useRevalidator()

  // Open the webhook instructions right after a repository is connected.
  const previous = useRef(source?.id ?? null)
  useEffect(() => {
    if (source && previous.current === null) {
      setEditing(false)
      setSetup(true)
    }
    previous.current = source?.id ?? null
  }, [source?.id])

  // Refresh while an import runs in the background.
  const running = imports.some((i) => i.state === "pending")
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => revalidator.state === "idle" && revalidator.revalidate(), 3000)
    return () => clearInterval(timer)
  }, [running, revalidator])

  if (!source) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex min-w-0 items-start gap-3">
          <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium">Publish releases from a repository</h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              Connect a GitHub repository to this {ownerLabel}. Each new version tag is downloaded as a zip, packaged with a fixed folder name and published as a release.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          <GitBranch /> Connect repository
        </Button>
        <SourceDialog open={editing} onOpenChange={setEditing} source={null} statuses={statuses} />
      </section>
    )
  }

  const provider = PROVIDER_INFO[source.provider]
  const repoUrl = `https://${provider.host}/${source.repository}`
  const toggle = () => action.submit({ intent: "save-source", enabled: String(!source.enabled) }, { method: "post" })

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            <a href={repoUrl} target="_blank" rel="noreferrer" className="font-mono text-sm font-medium break-all underline-offset-2 hover:underline">
              {source.repository}
            </a>
            <Badge variant="outline">{provider.label}</Badge>
            {!source.enabled && <Badge variant="warning">Paused</Badge>}
            {source.has_token && <Badge variant="secondary">Access token saved</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {TRIGGER_INFO[source.trigger].label}: publishes <span className="font-mono text-foreground">{packageFileName(source.package_folder, "<version>")}</span>, available when status is{" "}
            <span className="text-foreground">{describeStatusKeys(source.status_keys, statuses) || "no status"}</span>
            {source.check_domain ? ", for allowed sites" : ", without a domain check"}.
          </p>
          <p className="text-xs text-muted-foreground">
            {source.last_delivery_at ? (
              <>
                Last webhook delivery <Ago ts={source.last_delivery_at} />.
              </>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">No webhook delivery received yet. Add the webhook in GitHub to publish new tags automatically.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPublishing(true)} disabled={!source.enabled}>
            <Tag /> Publish a tag
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Repository actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => setSetup(true)}>
                <Webhook /> Webhook setup
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Settings2 /> Edit settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggle}>
                {source.enabled ? <Pause /> : <Play />} {source.enabled ? "Pause publishing" : "Resume publishing"}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={repoUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open on {provider.label}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDisconnecting(true)}>
                <Unplug /> Disconnect repository
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {action.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{action.data.error}</div>}

      {imports.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Recent tags <HelpTip>Each tag is published once. A failed or skipped tag can be retried; a redelivered webhook does not publish a tag twice.</HelpTip>
          </h4>
          <ul className="divide-y rounded-md border">
            {imports.map((row) => (
              <li key={row.id} className="grid gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[minmax(6rem,auto)_minmax(0,1fr)_auto] sm:items-center">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">{row.ref}</span>
                  <Badge variant={STATE_BADGE[row.state]}>{IMPORT_STATE_LABELS[row.state]}</Badge>
                </div>
                <p className="min-w-0 text-xs text-muted-foreground">
                  {row.detail || (row.state === "pending" ? "Downloading and publishing…" : "")} {row.commit_sha && <span className="font-mono">({row.commit_sha.slice(0, 7)})</span>}
                </p>
                <div className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground sm:justify-end">
                  <Ago ts={row.finished_at ?? row.started_at} />
                  {(row.state === "failed" || row.state === "skipped") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      disabled={action.state !== "idle"}
                      onClick={() => action.submit({ intent: "retry-import", importId: row.id }, { method: "post" })}
                    >
                      <RefreshCw /> Retry
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SourceDialog open={editing} onOpenChange={setEditing} source={source} statuses={statuses} />
      <WebhookDialog open={setup} onOpenChange={setSetup} source={source} />
      <PublishTagDialog open={publishing} onOpenChange={setPublishing} />
      <ConfirmAction
        intent="delete-source"
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect this repository?"
        description="New tags are no longer published. Releases already published stay available. Remove the webhook in GitHub as well."
        confirm="Disconnect"
      />
    </section>
  )
}

function SourceDialog({ open, onOpenChange, source, statuses: statusSet }: { open: boolean; onOpenChange: (open: boolean) => void; source: SourceView | null; statuses: StatusSet }) {
  const save = useFetcher<ActionResult>()
  const [provider, setProvider] = useState<ProviderKey>("github")
  const [repository, setRepository] = useState("")
  const [token, setToken] = useState("")
  const [removeToken, setRemoveToken] = useState(false)
  const [trigger, setTrigger] = useState<TriggerKey>("tag")
  const [folder, setFolder] = useState("")
  const [folderTouched, setFolderTouched] = useState(false)
  const [statuses, setStatuses] = useState<string[]>([])
  const [checkDomain, setCheckDomain] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!open) return
    setProvider(source?.provider ?? "github")
    setRepository(source?.repository ?? "")
    setToken("")
    setRemoveToken(false)
    setTrigger(source?.trigger ?? "tag")
    setFolder(source?.package_folder ?? "")
    setFolderTouched(Boolean(source))
    setStatuses(source?.status_keys ?? defaultReleaseStatuses(statusSet))
    setCheckDomain(source?.check_domain ?? true)
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (submitted && save.state === "idle" && save.data?.ok) onOpenChange(false)
  }, [submitted, save.state, save.data, onOpenChange])

  // Suggest the repository name as the folder until the folder is edited.
  const suggested =
    repository
      .trim()
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .split("/")
      .pop() ?? ""
  const shownFolder = folderTouched ? folder : suggested
  const folderError = shownFolder ? packageFolderError(shownFolder) : null
  const busy = save.state !== "idle"
  const info = PROVIDER_INFO[provider]

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{source ? "Repository settings" : "Connect a repository"}</DialogTitle>
          <DialogDescription>Warden downloads the repository as a zip when the trigger fires and publishes it as a release. Nothing is built: the repository is published as it is.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="source-provider">Provider</FieldLabel>
              <NativeSelect id="source-provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderKey)} disabled={busy}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_INFO[p].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="source-repository">Repository</FieldLabel>
              <Input id="source-repository" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="harbor-studio/harbor-theme" className="font-mono" disabled={busy} />
              <p className="text-xs text-muted-foreground">As {info.repositoryHint}.</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="source-token" help={info.tokenHelp}>
              Access token
            </FieldLabel>
            <Input
              id="source-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={source?.has_token ? "Saved. Enter a new token to replace it." : "Only for a private repository"}
              disabled={busy || removeToken}
              className="font-mono"
            />
            {source?.has_token && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={removeToken} onChange={(e) => setRemoveToken(e.target.checked)} disabled={busy} />
                Remove the saved token
              </label>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="source-trigger" help={TRIGGER_INFO[trigger].help}>
                Trigger
              </FieldLabel>
              <NativeSelect id="source-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as TriggerKey)} disabled={busy}>
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_INFO[t].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="source-folder" help={FOLDER_HELP}>
                Package folder
              </FieldLabel>
              <Input
                id="source-folder"
                value={shownFolder}
                onChange={(e) => {
                  setFolderTouched(true)
                  setFolder(e.target.value)
                }}
                placeholder="harbor-theme"
                className="font-mono"
                aria-invalid={Boolean(folderError)}
                disabled={busy}
              />
            </div>
          </div>
          {folderError ? (
            <p className="-mt-2 text-xs text-destructive">{folderError}</p>
          ) : (
            shownFolder && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Tag v1.4.0 publishes <span className="font-mono">{packageFileName(shownFolder, "1.4.0")}</span>, containing <span className="font-mono">{shownFolder}/</span>.
              </p>
            )
          )}
          <div className="space-y-1.5">
            <FieldLabel help="Published releases can be downloaded only while the licence has one of these statuses. Each release can be changed afterwards.">
              Available when licence status is
            </FieldLabel>
            <StatusPicker statuses={statusSet} value={statuses} onChange={setStatuses} disabled={busy} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={checkDomain} onChange={(e) => setCheckDomain(e.target.checked)} disabled={busy} />
            Only for allowed sites (domain check)
          </label>
          {submitted && save.state === "idle" && save.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{save.data.error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !repository.trim() || !shownFolder || Boolean(folderError) || statuses.length === 0}
            onClick={() => {
              setSubmitted(true)
              save.submit(
                {
                  intent: "save-source",
                  provider,
                  repository: repository.trim(),
                  token: token.trim(),
                  remove_token: String(removeToken),
                  trigger,
                  package_folder: shownFolder.trim(),
                  statuses: statuses.join(","),
                  check_domain: String(checkDomain),
                },
                { method: "post" },
              )
            }}
          >
            {busy ? "Checking the repository…" : source ? "Save changes" : "Connect repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CopyField({ label, value, secret = false, help }: { label: string; value: string; secret?: boolean; help?: string }) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(!secret)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  return (
    <div className="min-w-0 space-y-1">
      <FieldLabel help={help}>{label}</FieldLabel>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs">{shown ? value : "•".repeat(24)}</code>
        {secret && (
          <Button type="button" variant="outline" size="sm" onClick={() => setShown(!shown)}>
            {shown ? "Hide" : "Show"}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}

function WebhookDialog({ open, onOpenChange, source }: { open: boolean; onOpenChange: (open: boolean) => void; source: SourceView }) {
  const regenerate = useFetcher<ActionResult>()
  const settingsUrl = `https://${PROVIDER_INFO[source.provider].host}/${source.repository}/settings/hooks/new`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Webhook setup</DialogTitle>
          <DialogDescription>GitHub notifies Warden of new tags through a webhook. Add it once in the repository settings.</DialogDescription>
        </DialogHeader>
        <ol className="min-w-0 list-decimal space-y-4 pl-5 text-sm marker:text-muted-foreground">
          <li className="space-y-2">
            <p>
              Open{" "}
              <a href={settingsUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                Settings, Webhooks, Add webhook
              </a>{" "}
              for <span className="font-mono break-all">{source.repository}</span>.
            </p>
          </li>
          <li className="space-y-3">
            <p>Enter these values:</p>
            <CopyField label="Payload URL" value={source.webhook_url} />
            <div className="space-y-1">
              <FieldLabel>Content type</FieldLabel>
              <p className="font-mono text-xs">application/json</p>
            </div>
            <CopyField label="Secret" value={source.webhook_secret} secret help="Warden rejects deliveries that are not signed with this secret." />
          </li>
          <li>
            Under <span className="font-medium">Which events</span>, keep <span className="font-medium">Just the push event</span>, then select <span className="font-medium">Add webhook</span>.
          </li>
          <li>GitHub sends a test delivery. This page then shows the time of the last delivery.</li>
        </ol>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={regenerate.state !== "idle"}
            onClick={() => regenerate.submit({ intent: "regenerate-source-secret" }, { method: "post" })}
            title="Replaces the secret. Update it in GitHub afterwards."
          >
            <RefreshCw /> {regenerate.state !== "idle" ? "Generating…" : "Generate a new secret"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PublishTagDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const publish = useFetcher<ActionResult>()
  const [tag, setTag] = useState("")
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (!open) return
    setTag("")
    setSubmitted(false)
  }, [open])
  useEffect(() => {
    if (submitted && publish.state === "idle" && publish.data?.ok) onOpenChange(false)
  }, [submitted, publish.state, publish.data, onOpenChange])
  const busy = publish.state !== "idle"
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish a tag</DialogTitle>
          <DialogDescription>Publishes the repository as it is at an existing tag, for example a tag pushed before the webhook was added.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!tag.trim()) return
            setSubmitted(true)
            publish.submit({ intent: "import-tag", tag: tag.trim() }, { method: "post" })
          }}
        >
          <FieldLabel htmlFor="publish-tag">Tag</FieldLabel>
          <Input id="publish-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="v1.4.0" className="font-mono" autoFocus disabled={busy} />
          {submitted && publish.state === "idle" && publish.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{publish.data.error}</div>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !tag.trim()}>
              <Tag /> {busy ? "Starting…" : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
