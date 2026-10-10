import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useFetcher, useRevalidator } from "react-router"
import { Archive, ArchiveRestore, Copy, FileUp, FlaskConical, Link2, MoreHorizontal, Paperclip, Pencil, Trash2, Upload } from "lucide-react"
import { FieldLabel, HelpTip } from "#/components/help-tip"
import { StatusPicker } from "#/components/status-picker"
import { Ago } from "#/components/time"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { NativeSelect } from "#/components/ui/native-select"
import { Textarea } from "#/components/ui/textarea"
import { defaultReleaseStatuses, evaluateFileAccess, MAX_FILE_BYTES } from "#/lib/files"
import { CHANNELS, isValidVersion, latestRelease, MAX_CHANGELOG_LENGTH, sortForDisplay, type Channel } from "#/lib/releases"
import { describeStatusKeys, splitStatusKeys, type StatusSet } from "#/lib/statuses"
import { cn } from "#/lib/utils"

export type FileRow = {
  id: string
  name: string
  version: string
  channel: Channel
  changelog: string
  notes: string
  sha256: string
  withdrawn_at: number | null
  statuses: string
  check_domain: number
  size: number
  uploaded_at: number
  download_count: number
  last_download_at: number | null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type LicenseState = { status: string; expires_at: number | null; domains: string }

/** Files shared by the licence's app. `statuses` are the app's statuses, which the files' release rules refer to. */
export type SharedFiles = { appName: string; appHref: string; files: FileRow[]; statuses: StatusSet }

type ActionResult = { ok?: true; error?: string }

const AVAILABILITY_HELP =
  "The file can be downloaded only while the licence has one of these statuses. Typical choices: the statuses that let the site run for updates, only the paid-in-full status for a final release, or only the suspended status for a maintenance notice."
const DOMAIN_HELP = "When on, the download must include a domain (?domain=) the licence allows, within its site limit. Turn it off for files someone downloads by hand. Ignored when the licence has no allowed domains and no site limit."
const VERSION_HELP = "A version makes the file a release: sites that send their version with their check are offered it as an update. Leave it empty for an attachment such as a manual or a notice."
const CHANNEL_HELP = "Stable releases are offered to every site. Beta releases are offered only to sites that check with channel=beta."
const CHANGELOG_HELP = "Public. Returned to sites with the release, so they can show what changed before updating."

/** Suggests a version from a file name such as harbor-theme-1.4.0.zip or plugin_v2.1.zip. */
export function versionFromFileName(name: string): string {
  const match = name.replace(/\.(zip|tar\.gz|tgz|gz|rar|7z|pdf|exe|dmg|msi|jar)$/i, "").match(/(?:^|[^0-9A-Za-z])v?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.]+)?)$/)
  return match && isValidVersion(match[1]) ? match[1] : ""
}

type Row = { file: FileRow; shared: boolean; statuses: StatusSet }

export function FilesSection({
  description,
  uploadPath,
  downloadUrl,
  license = null,
  files,
  statuses: statusSet,
  shared = null,
  configured,
  ownerLabel,
}: {
  description: string
  /** Where uploads are sent, for example /licenses/<id>/files. */
  uploadPath: string
  /** Builds the public download link of a file. Omit for app files, which have no single link. */
  downloadUrl?: (fileId: string) => string
  /** The licence the files are checked against, to show what it can download now. Omit for app files. */
  license?: LicenseState | null
  files: FileRow[]
  /** The statuses the files' release rules refer to. */
  statuses: StatusSet
  /** Read-only files that come from the licence's app. */
  shared?: SharedFiles | null
  configured: boolean
  /** "app" or "licence", for the texts. */
  ownerLabel: string
}) {
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<FileRow | null>(null)
  const [removing, setRemoving] = useState<FileRow | null>(null)
  const action = useFetcher<ActionResult>()
  const [copied, setCopied] = useState<string | null>(null)

  const rows: Row[] = useMemo(() => {
    const own = files.map((file) => ({ file, shared: false, statuses: statusSet }))
    const fromApp = (shared?.files ?? []).map((file) => ({ file, shared: true, statuses: shared!.statuses }))
    const all = [...own, ...fromApp]
    const order = sortForDisplay(all.map((r) => r.file))
    return order.map((f) => all.find((r) => r.file === f)!)
  }, [files, shared, statusSet])

  const availability = (row: Row) => {
    if (!license) return null
    if (row.file.withdrawn_at !== null) return false
    const rule = { statuses: splitStatusKeys(row.file.statuses, row.statuses), check_domain: row.file.check_domain === 1 }
    return evaluateFileAccess(license, rule, null, Date.now(), true, statusSet, row.statuses).allowed
  }
  // The release a site of this licence (or any licence, for an app) is offered: newest stable among those available.
  const latest = latestRelease(rows.filter((r) => availability(r) !== false).map((r) => r.file))
  const releases = rows.filter((r) => r.file.version.trim() !== "")
  const attachments = rows.filter((r) => r.file.version.trim() === "")

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1600)
    } catch {}
  }
  const setWithdrawn = (file: FileRow, withdrawn: boolean) => action.submit({ intent: "update-file", fileId: file.id, withdrawn: String(withdrawn) }, { method: "post" })

  if (!configured) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        File storage is not configured. Activate R2 in the Cloudflare dashboard and redeploy; the <code>FILES</code> bucket is created automatically.
      </p>
    )
  }

  const table = (list: Row[], kind: "releases" | "attachments") => (
    <ul className="divide-y rounded-lg border bg-card">
      {list.map((row) => {
        const f = row.file
        const available = availability(row)
        const withdrawn = f.withdrawn_at !== null
        const isLatest = latest?.id === f.id
        return (
          <li key={f.id} className={cn("grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]", withdrawn && "bg-muted/40")}>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {kind === "releases" ? (
                  <span className={cn("font-mono text-sm font-semibold", withdrawn && "text-muted-foreground line-through")}>{f.version}</span>
                ) : (
                  <Paperclip className="size-3.5 text-muted-foreground" />
                )}
                {isLatest && <Badge variant="success">Latest</Badge>}
                {f.channel === "beta" && (
                  <Badge variant="info">
                    <FlaskConical /> Beta
                  </Badge>
                )}
                {withdrawn && <Badge variant="secondary">Withdrawn</Badge>}
                {row.shared && <Badge variant="outline">From {shared?.appName}</Badge>}
                {available !== null && !withdrawn && <Badge variant={available ? "success" : "secondary"}>{available ? "Available now" : "Not available now"}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className={cn("break-all", kind === "attachments" && "text-sm font-medium text-foreground")}>{f.name}</span>
                <span>{formatBytes(f.size)}</span>
                <span>
                  Uploaded <Ago ts={f.uploaded_at} />
                </span>
                <span>
                  {f.download_count} download{f.download_count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Available when status is <span className="text-foreground">{describeStatusKeys(splitStatusKeys(f.statuses, row.statuses), row.statuses) || "no status"}</span>
                {f.check_domain ? ", for allowed sites" : ", without a domain check"}
              </div>
              {f.changelog && <p className="line-clamp-2 max-w-prose text-sm whitespace-pre-line text-muted-foreground">{f.changelog}</p>}
            </div>
            <div className="flex items-start gap-1 sm:justify-end">
              {copied?.startsWith(f.id) && <span className="py-1.5 text-xs text-muted-foreground">Copied</span>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${f.name}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {!row.shared && (
                    <DropdownMenuItem onClick={() => setEditing(f)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                  )}
                  {downloadUrl && (
                    <DropdownMenuItem onClick={() => copy(downloadUrl(f.id), `${f.id}-link`)}>
                      <Link2 /> Copy download link
                    </DropdownMenuItem>
                  )}
                  {f.sha256 && (
                    <DropdownMenuItem onClick={() => copy(f.sha256, `${f.id}-sha`)}>
                      <Copy /> Copy SHA-256 checksum
                    </DropdownMenuItem>
                  )}
                  {!row.shared && f.version && (
                    <DropdownMenuItem onClick={() => setWithdrawn(f, !withdrawn)}>
                      {withdrawn ? <ArchiveRestore /> : <Archive />} {withdrawn ? "Restore release" : "Withdraw release"}
                    </DropdownMenuItem>
                  )}
                  {!row.shared && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setRemoving(f)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </>
                  )}
                  {row.shared && (
                    <DropdownMenuItem asChild>
                      <Link to={shared!.appHref + "?tab=releases"}>Manage on the app page</Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        <Button onClick={() => setUploading(true)}>
          <Upload /> Upload
        </Button>
      </div>
      {action.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{action.data.error}</div>}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <FileUp className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="font-medium">No files yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Upload a build with a version to publish it as a release: sites that send their version with their check are offered it as an update.
          </p>
        </div>
      ) : (
        <>
          {releases.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                Releases <HelpTip>{VERSION_HELP} &ldquo;Latest&rdquo; marks the stable release sites are offered{license ? " under this licence's current status" : ""}.</HelpTip>
              </h3>
              {table(releases, "releases")}
            </section>
          )}
          {attachments.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Attachments</h3>
              {table(attachments, "attachments")}
            </section>
          )}
        </>
      )}

      <UploadDialog open={uploading} onOpenChange={setUploading} uploadPath={uploadPath} statuses={statusSet} ownerLabel={ownerLabel} />
      <EditDialog file={editing} onClose={() => setEditing(null)} statuses={statusSet} />

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing?.name}?</DialogTitle>
            <DialogDescription>
              The file is removed from storage and its download link stops working. Copies already downloaded are not affected.{removing?.version ? " To stop offering a release but keep its record, withdraw it instead." : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={action.state !== "idle"}
              onClick={() => {
                if (removing) action.submit({ intent: "delete-file", fileId: removing.id }, { method: "post" })
                setRemoving(null)
              }}
            >
              Delete file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReleaseFields({
  version,
  setVersion,
  channel,
  setChannel,
  changelog,
  setChangelog,
  disabled,
}: {
  version: string
  setVersion: (v: string) => void
  channel: Channel
  setChannel: (c: Channel) => void
  changelog: string
  setChangelog: (v: string) => void
  disabled?: boolean
}) {
  const invalid = version.trim() !== "" && !isValidVersion(version.trim())
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="release-version" help={VERSION_HELP}>
            Version
          </FieldLabel>
          <Input id="release-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.4.0, or empty for an attachment" disabled={disabled} aria-invalid={invalid} className="font-mono" />
          {invalid && <p className="text-xs text-destructive">Use numbers separated by dots, optionally with a suffix: 1.4.0 or 2.0.0-beta.1.</p>}
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="release-channel" help={CHANNEL_HELP}>
            Channel
          </FieldLabel>
          <NativeSelect id="release-channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} disabled={disabled || !version.trim()}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c === "stable" ? "Stable" : "Beta"}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {version.trim() && (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="release-changelog" help={CHANGELOG_HELP}>
            Release notes
          </FieldLabel>
          <Textarea id="release-changelog" rows={4} maxLength={MAX_CHANGELOG_LENGTH} value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed in this version" disabled={disabled} />
        </div>
      )}
    </>
  )
}

function UploadDialog({ open, onOpenChange, uploadPath, statuses: statusSet, ownerLabel }: { open: boolean; onOpenChange: (open: boolean) => void; uploadPath: string; statuses: StatusSet; ownerLabel: string }) {
  const revalidator = useRevalidator()
  const notes = useFetcher<ActionResult>()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [version, setVersion] = useState("")
  const [channel, setChannel] = useState<Channel>("stable")
  const [changelog, setChangelog] = useState("")
  const [statuses, setStatuses] = useState<string[]>(() => defaultReleaseStatuses(statusSet))
  const [checkDomain, setCheckDomain] = useState(true)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setFile(null)
    setVersion("")
    setChannel("stable")
    setChangelog("")
    setStatuses(defaultReleaseStatuses(statusSet))
    setCheckDomain(true)
    setError("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const choose = (picked: File | undefined) => {
    if (!picked) return
    setFile(picked)
    if (!version) setVersion(versionFromFileName(picked.name))
  }

  const busy = progress !== null

  function upload() {
    if (!file) return setError("Choose a file to upload.")
    if (file.size > MAX_FILE_BYTES) return setError(`The file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`)
    if (version.trim() && !isValidVersion(version.trim())) return setError("Enter a valid version, or leave it empty for an attachment.")
    if (statuses.length === 0) return setError("Select at least one licence status.")
    setError("")
    setProgress(0)
    const query = new URLSearchParams({ name: file.name, version: version.trim(), channel, statuses: statuses.join(","), check_domain: String(checkDomain) })
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", `${uploadPath}?${query}`)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total)
    xhr.onerror = () => {
      setProgress(null)
      setError("The upload failed. Check your connection and try again.")
    }
    xhr.onload = () => {
      setProgress(null)
      let body: { file?: { id: string }; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {}
      if (xhr.status !== 201 || !body.file) return setError(body.error ?? "The upload was rejected.")
      // Release notes can be long, so they are saved with a second request rather than in the upload address.
      if (version.trim() && changelog.trim()) notes.submit({ intent: "update-file", fileId: body.file.id, changelog }, { method: "post" })
      else revalidator.revalidate()
      onOpenChange(false)
    }
    xhr.send(file)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Upload a file</DialogTitle>
          <DialogDescription>
            {ownerLabel === "app" ? "Every licence of this app sees the file, subject to its release rule." : "Only this licence sees the file."} Up to {MAX_FILE_BYTES / 1024 / 1024} MB.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              choose(e.dataTransfer.files[0])
            }}
            disabled={busy}
            className={cn("flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors hover:bg-muted/50", dragging && "border-foreground bg-muted/50")}
          >
            <FileUp className="size-5 text-muted-foreground" />
            {file ? (
              <>
                <span className="font-medium break-all">{file.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(file.size)}. Click to choose another file.</span>
              </>
            ) : (
              <>
                <span className="font-medium">Drop a file here, or click to choose one</span>
                <span className="text-xs text-muted-foreground">A version in the file name, such as theme-1.4.0.zip, is filled in for you.</span>
              </>
            )}
          </button>
          <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="File" onChange={(e) => choose(e.target.files?.[0])} />

          <ReleaseFields version={version} setVersion={setVersion} channel={channel} setChannel={setChannel} changelog={changelog} setChangelog={setChangelog} disabled={busy} />

          <div className="space-y-1.5">
            <FieldLabel help={AVAILABILITY_HELP}>Available when licence status is</FieldLabel>
            <StatusPicker statuses={statusSet} value={statuses} onChange={setStatuses} disabled={busy} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={checkDomain} onChange={(e) => setCheckDomain(e.target.checked)} disabled={busy} />
            Only for allowed sites (domain check)
            <HelpTip>{DOMAIN_HELP}</HelpTip>
          </label>
          {busy && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
          )}
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={upload} disabled={busy || !file}>
            <Upload /> {busy ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : version.trim() ? `Publish ${version.trim()}` : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ file, onClose, statuses: statusSet }: { file: FileRow | null; onClose: () => void; statuses: StatusSet }) {
  const update = useFetcher<ActionResult>()
  const [version, setVersion] = useState("")
  const [channel, setChannel] = useState<Channel>("stable")
  const [changelog, setChangelog] = useState("")
  const [notes, setNotes] = useState("")
  const [statuses, setStatuses] = useState<string[]>([])
  const [checkDomain, setCheckDomain] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!file) return
    setVersion(file.version)
    setChannel(file.channel)
    setChangelog(file.changelog)
    setNotes(file.notes)
    setStatuses(splitStatusKeys(file.statuses, statusSet))
    setCheckDomain(file.check_domain === 1)
    setSubmitted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id])

  // Close once the save succeeded; keep the dialog open to show an error.
  useEffect(() => {
    if (submitted && update.state === "idle" && update.data?.ok) onClose()
  }, [submitted, update.state, update.data, onClose])

  const busy = update.state !== "idle"
  return (
    <Dialog open={file !== null} onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="break-all">Edit {file?.name}</DialogTitle>
          <DialogDescription>Change the version and notes of this file, and when it can be downloaded.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ReleaseFields version={version} setVersion={setVersion} channel={channel} setChannel={setChannel} changelog={changelog} setChangelog={setChangelog} />
          <div className="space-y-1.5">
            <FieldLabel help={AVAILABILITY_HELP}>Available when licence status is</FieldLabel>
            <StatusPicker statuses={statusSet} value={statuses} onChange={setStatuses} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={checkDomain} onChange={(e) => setCheckDomain(e.target.checked)} />
            Only for allowed sites (domain check)
            <HelpTip>{DOMAIN_HELP}</HelpTip>
          </label>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="file-notes" help="For your own reference. Never sent to sites.">
              Internal notes
            </FieldLabel>
            <Input id="file-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {submitted && update.state === "idle" && update.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{update.data.error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || statuses.length === 0 || (version.trim() !== "" && !isValidVersion(version.trim()))}
            onClick={() => {
              if (!file) return
              setSubmitted(true)
              update.submit(
                { intent: "update-file", fileId: file.id, version: version.trim(), channel, changelog: version.trim() ? changelog : file.changelog, notes, statuses: statuses.join(","), check_domain: String(checkDomain) },
                { method: "post" }
              )
            }}
          >
            {busy ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
