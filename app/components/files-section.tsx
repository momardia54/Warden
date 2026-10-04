import { useRef, useState } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { Download, FileUp, Trash2 } from "lucide-react"
import { CopyButton } from "#/components/code-block"
import { Ago } from "#/components/time"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { NativeSelect } from "#/components/ui/native-select"
import { FILE_KINDS, fileAccess, KIND_HINT, KIND_LABEL, MAX_FILE_BYTES, type FileKind } from "#/lib/files"

export type FileRow = { id: string; name: string; kind: FileKind; version: string; size: number; uploaded_at: number; download_count: number; last_download_at: number | null }

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

type LicenseState = { name: string; status: string; expires_at: number | null; domains: string; message: string }

export function FilesSection({ licenseId, licenseKey, origin, license, files, configured }: { licenseId: string; licenseKey: string; origin: string; license: LicenseState; files: FileRow[]; configured: boolean }) {
  const revalidator = useRevalidator()
  const remove = useFetcher()
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<FileKind>("update")
  const [version, setVersion] = useState("")
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [removing, setRemoving] = useState<FileRow | null>(null)

  function upload() {
    const file = input.current?.files?.[0]
    if (!file) return setError("Choose a file first.")
    if (file.size > MAX_FILE_BYTES) return setError(`That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
    setError("")
    setProgress(0)
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", `/licenses/${licenseId}/files?name=${encodeURIComponent(file.name)}&kind=${kind}&version=${encodeURIComponent(version)}`)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total)
    xhr.onerror = () => {
      setProgress(null)
      setError("The upload failed. Check your connection and try again.")
    }
    xhr.onload = () => {
      setProgress(null)
      if (xhr.status === 201) {
        if (input.current) input.current.value = ""
        setVersion("")
        revalidator.revalidate()
      } else {
        try {
          setError(JSON.parse(xhr.responseText).error ?? "The upload was refused.")
        } catch {
          setError("The upload was refused.")
        }
      }
    }
    xhr.send(file)
  }

  const uploading = progress !== null

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">Files</h2>
        <p className="text-xs text-muted-foreground">
          Attach a download to this licence. <b>Update</b> files can be fetched while the licence is active or completed. <b>Final</b> files are released only once it is <b>completed</b> (paid in full).
        </p>
      </div>

      {!configured ? (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          File storage is not set up on this install. Activate R2 in the Cloudflare dashboard and redeploy; the <code>FILES</code> bucket is then created automatically.
        </p>
      ) : (
        <>
          {files.length > 0 && (
            <ul className="divide-y rounded-md border">
              {files.map((f) => {
                const access = fileAccess(license, f.kind, null, Date.now(), true)
                const url = `${origin}/download/${licenseKey}/${f.id}`
                return (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Download className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium break-all">{f.name}</span>
                        <Badge variant="outline">{KIND_LABEL[f.kind]}</Badge>
                        {f.version && <span className="text-xs text-muted-foreground">v{f.version}</span>}
                        <Badge variant={access.allowed ? "success" : "secondary"}>{access.allowed ? "Available now" : "Locked"}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(f.size)} · uploaded <Ago ts={f.uploaded_at} /> · {f.download_count} download{f.download_count === 1 ? "" : "s"}
                        {f.last_download_at ? <> (last <Ago ts={f.last_download_at} />)</> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <CopyButton text={url} className="h-8 border px-2 text-xs" />
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${f.name}`} onClick={() => setRemoving(f)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_8rem_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="file">File (up to {MAX_FILE_BYTES / 1024 / 1024} MB)</Label>
              <Input id="file" ref={input} type="file" disabled={uploading} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kind">Kind</Label>
              <NativeSelect id="kind" value={kind} onChange={(e) => setKind(e.target.value as FileKind)} disabled={uploading}>
                {FILE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="version">Version</Label>
              <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" disabled={uploading} />
            </div>
            <Button type="button" onClick={upload} disabled={uploading}>
              <FileUp /> {uploading ? `${Math.round((progress ?? 0) * 100)}%` : "Upload"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </>
      )}

      <Dialog open={removing !== null} onOpenChange={(next) => remove.state === "idle" && !next && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing?.name}?</DialogTitle>
            <DialogDescription>The file is removed from storage and its download link stops working. Copies already downloaded are not affected.</DialogDescription>
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
