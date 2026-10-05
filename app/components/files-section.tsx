import { useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { FileUp, Pencil, Trash2 } from "lucide-react"
import { CopyButton } from "#/components/code-block"
import { FieldLabel, HelpTip } from "#/components/help-tip"
import { StatusPicker } from "#/components/status-picker"
import { Ago } from "#/components/time"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { defaultReleaseStatuses, evaluateFileAccess, MAX_FILE_BYTES } from "#/lib/files"
import { describeStatusKeys, splitStatusKeys, type StatusSet } from "#/lib/statuses"

export type FileRow = {
  id: string
  name: string
  version: string
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

const AVAILABILITY_HELP = (
  <>
    Each file is downloadable only while the licence has one of the statuses you select. Examples: for example every status that lets the site run for updates, only the paid-in-full status for a final release,{" "}
    or only the suspended status for a maintenance notice.
  </>
)
const DOMAIN_HELP = "When on, the download request must include a domain (?domain=) that matches the licence's allowed domains. Ignored if the licence has no allowed domains."

/** `statuses` are the statuses the file's release rule refers to; `licenseStatuses` are the licence's own, used for its current status. */
function FileRowItem({ file: f, license, statuses, licenseStatuses, link, onEdit, onDelete }: { file: FileRow; license: LicenseState | null; statuses: StatusSet; licenseStatuses: StatusSet; link?: string; onEdit?: () => void; onDelete?: () => void }) {
  const rule = { statuses: splitStatusKeys(f.statuses, statuses), check_domain: f.check_domain === 1 }
  const availability = license ? evaluateFileAccess(license, rule, null, Date.now(), true, licenseStatuses, statuses).allowed : null
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{f.name}</span>
          {f.version && <span className="text-xs text-muted-foreground">v{f.version}</span>}
          {availability !== null && <Badge variant={availability ? "success" : "secondary"}>{availability ? "Available now" : "Not available now"}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          Available when status is: <span className="text-foreground">{describeStatusKeys(rule.statuses, statuses)}</span>
          {rule.check_domain ? "" : " · domain not checked"}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatBytes(f.size)} · uploaded <Ago ts={f.uploaded_at} /> · {f.download_count} download{f.download_count === 1 ? "" : "s"}
          {f.last_download_at ? <> (last <Ago ts={f.last_download_at} />)</> : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {link && <CopyButton text={link} className="h-8 border px-2 text-xs" />}
        {onEdit && (
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Edit ${f.name}`} onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${f.name}`} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
}

type FilesSectionProps = {
  title?: string
  description: string
  /** Where the upload is sent, for example /licenses/<id>/files. */
  uploadPath: string
  /** Builds the public download link of a file. Omit when the files have no single link (shared app files). */
  downloadUrl?: (fileId: string) => string
  /** The licence the files are checked against, to show whether each file is available now. Omit for app files. */
  license?: LicenseState | null
  files: FileRow[]
  /** The statuses that apply to these files: the status set of the licence's app, or of the app that owns them. */
  statuses: StatusSet
  /** Read-only list of the files that come from the licence's app. */
  shared?: SharedFiles | null
  configured: boolean
}

export function FilesSection({ title = "Files", description, uploadPath, downloadUrl, license = null, files, statuses: statusSet, shared = null, configured }: FilesSectionProps) {
  const revalidator = useRevalidator()
  const remove = useFetcher()
  const update = useFetcher()
  const input = useRef<HTMLInputElement>(null)
  const [version, setVersion] = useState("")
  const [statuses, setStatuses] = useState<string[]>(() => defaultReleaseStatuses(statusSet))
  const [checkDomain, setCheckDomain] = useState(true)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [removing, setRemoving] = useState<FileRow | null>(null)
  const [editing, setEditing] = useState<FileRow | null>(null)
  const [editStatuses, setEditStatuses] = useState<string[]>([])
  const [editCheckDomain, setEditCheckDomain] = useState(true)
  const [editVersion, setEditVersion] = useState("")

  function upload() {
    const file = input.current?.files?.[0]
    if (!file) return setError("Choose a file to upload.")
    if (statuses.length === 0) return setError("Select at least one licence status.")
    if (file.size > MAX_FILE_BYTES) return setError(`The file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`)
    setError("")
    setProgress(0)
    const query = new URLSearchParams({ name: file.name, version, statuses: statuses.join(","), check_domain: String(checkDomain) })
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", `${uploadPath}?${query}`)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total)
    xhr.onerror = () => {
      setProgress(null)
      setError("Upload failed. Check your connection and try again.")
    }
    xhr.onload = () => {
      setProgress(null)
      if (xhr.status === 201) {
        if (input.current) input.current.value = ""
        setVersion("")
        revalidator.revalidate()
        return
      }
      try {
        setError(JSON.parse(xhr.responseText).error ?? "The upload was rejected.")
      } catch {
        setError("The upload was rejected.")
      }
    }
    xhr.send(file)
  }

  function openEditor(file: FileRow) {
    setEditing(file)
    setEditStatuses(splitStatusKeys(file.statuses, statusSet))
    setEditCheckDomain(file.check_domain === 1)
    setEditVersion(file.version)
  }

  const uploading = progress !== null

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {!configured ? (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          File storage is not configured. Enable R2 in the Cloudflare dashboard and redeploy; the <code>FILES</code> bucket is created automatically.
        </p>
      ) : (
        <>
          {files.length > 0 && (
            <ul className="divide-y rounded-md border">
              {files.map((f) => (
                <FileRowItem key={f.id} file={f} license={license} statuses={statusSet} licenseStatuses={statusSet} link={downloadUrl?.(f.id)} onEdit={() => openEditor(f)} onDelete={() => setRemoving(f)} />
              ))}
            </ul>
          )}

          {shared && shared.files.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Shared by the app <a className="text-foreground underline underline-offset-2" href={shared.appHref}>{shared.appName}</a> (managed on the app page)
              </p>
              <ul className="divide-y rounded-md border">
                {shared.files.map((f) => (
                  <FileRowItem key={f.id} file={f} license={license} statuses={shared.statuses} licenseStatuses={statusSet} link={downloadUrl?.(f.id)} />
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-4 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Upload a file</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="file" help={`Maximum size ${MAX_FILE_BYTES / 1024 / 1024} MB.`}>
                  File
                </FieldLabel>
                <Input id="file" ref={input} type="file" disabled={uploading} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="version" help="Optional. Shown in the file list and returned by the download endpoint, so a site can compare it with the installed version.">
                  Version
                </FieldLabel>
                <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" disabled={uploading} />
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel help={AVAILABILITY_HELP}>Available when licence status is</FieldLabel>
              <StatusPicker statuses={statusSet} value={statuses} onChange={setStatuses} disabled={uploading} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={checkDomain} onChange={(e) => setCheckDomain(e.target.checked)} disabled={uploading} />
                Require a matching domain
                <HelpTip>{DOMAIN_HELP}</HelpTip>
              </label>
              <Button type="button" onClick={upload} disabled={uploading}>
                <FileUp /> {uploading ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : "Upload"}
              </Button>
            </div>
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          </div>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => update.state === "idle" && !next && setEditing(null)}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
            <DialogDescription>Change when this file can be downloaded.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel help={AVAILABILITY_HELP}>Available when licence status is</FieldLabel>
              <StatusPicker statuses={statusSet} value={editStatuses} onChange={setEditStatuses} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={editCheckDomain} onChange={(e) => setEditCheckDomain(e.target.checked)} />
              Require a matching domain
              <HelpTip>{DOMAIN_HELP}</HelpTip>
            </label>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="edit-version">Version</FieldLabel>
              <Input id="edit-version" value={editVersion} onChange={(e) => setEditVersion(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={update.state !== "idle"}>
              Cancel
            </Button>
            <Button
              disabled={update.state !== "idle" || editStatuses.length === 0}
              onClick={() =>
                editing &&
                update
                  .submit({ intent: "update-file", fileId: editing.id, statuses: editStatuses.join(","), check_domain: String(editCheckDomain), version: editVersion }, { method: "post" })
                  .then(() => setEditing(null))
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => remove.state === "idle" && !next && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing?.name}?</DialogTitle>
            <DialogDescription>The file is removed from storage and its download link stops working. Copies that were already downloaded are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={remove.state !== "idle"}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.state !== "idle"}
              onClick={() => removing && remove.submit({ intent: "delete-file", fileId: removing.id }, { method: "post" }).then(() => setRemoving(null))}
            >
              Delete file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
