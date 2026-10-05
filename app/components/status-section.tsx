import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { FieldLabel, HelpTip } from "#/components/help-tip"
import { StatusEditor } from "#/components/status-editor"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { NativeSelect } from "#/components/ui/native-select"
import { findStatus, type StatusSet } from "#/lib/statuses"

type Props = {
  /** What the statuses belong to, used in the text: "app" or "licence". */
  owner: "app" | "licence"
  /** The statuses in effect for the owner. */
  statuses: StatusSet
  /** The statuses the owner falls back to when it has none of its own: the built-in defaults. */
  fallback: StatusSet
  /** Whether the owner has statuses of its own. */
  custom: boolean
  /** Number of licences per status key. */
  usage: Record<string, number>
  /** Route that handles the status forms. */
  actionPath: string
  /** Where the statuses come from when the owner has none of its own, for example "the default statuses". */
  inheritedFrom: string
}

/** Shows the statuses an app or a licence uses, and lets you customise them, edit them and go back to the inherited ones. */
export function StatusSection({ owner, statuses, fallback, custom, usage, actionPath, inheritedFrom }: Props) {
  const customize = useFetcher<{ ok?: true; error?: string } | null>()
  const help =
    owner === "app"
      ? "The statuses licences of this app can have. By default an app uses the default statuses. Customising gives the app its own copy, which you can change freely without affecting other apps."
      : "The statuses of this standalone licence. By default it uses the default statuses. Customising gives this licence its own copy to change freely. A licence that belongs to an app uses its app's statuses instead."

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 font-semibold">
          Statuses <HelpTip>{help}</HelpTip>
        </h2>
        <p className="text-xs text-muted-foreground">{custom ? `This ${owner} has its own statuses.` : `This ${owner} uses ${inheritedFrom}.`}</p>
      </div>
      {custom ? (
        <>
          <StatusEditor statuses={statuses} usage={usage} actionPath={actionPath} />
          <ResetStatuses owner={owner} custom={statuses} fallback={fallback} usage={usage} actionPath={actionPath} />
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <Button variant="outline" disabled={customize.state !== "idle"} onClick={() => customize.submit({ intent: "customize-statuses" }, { method: "post", action: actionPath })}>
            Customise statuses for this {owner}
          </Button>
          {customize.data && "error" in customize.data && <p className="text-sm text-destructive">{customize.data.error}</p>}
        </div>
      )}
    </section>
  )
}

/** Removes the owner's own statuses. Statuses the default set lacks, and that licences use, need a replacement. */
function ResetStatuses({ owner, custom, fallback, usage, actionPath }: { owner: "app" | "licence"; custom: StatusSet; fallback: StatusSet; usage: Record<string, number>; actionPath: string }) {
  const fetcher = useFetcher<{ ok?: true; error?: string } | null>()
  const [open, setOpen] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const needed = custom.filter((s) => !findStatus(fallback, s.key) && (usage[s.key] ?? 0) > 0)

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false)
  }, [fetcher.state, fetcher.data])

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          fetcher.reset()
          setOpen(true)
        }}
      >
        Use the default statuses again
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Use the default statuses again?</DialogTitle>
            <DialogDescription>
              This {owner}&apos;s own statuses are removed and it goes back to the default statuses. Licences keep the status with the same identifier; the ones below have no match.
            </DialogDescription>
          </DialogHeader>
          {needed.length > 0 ? (
            <div className="space-y-3">
              {needed.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <FieldLabel htmlFor={`map-${s.key}`}>
                    {s.label} ({usage[s.key]} licence{usage[s.key] === 1 ? "" : "s"}) moves to
                  </FieldLabel>
                  <NativeSelect id={`map-${s.key}`} value={mapping[s.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [s.key]: e.target.value })}>
                    <option value="">Choose a status</option>
                    {fallback.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No licence uses a status that the default statuses lack.</p>
          )}
          {fetcher.data && "error" in fetcher.data && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{fetcher.data.error}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={fetcher.state !== "idle"}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={fetcher.state !== "idle" || needed.some((s) => !mapping[s.key])}
              onClick={() => fetcher.submit({ intent: "reset-statuses", ...Object.fromEntries(Object.entries(mapping).map(([k, v]) => [`map_${k}`, v])) }, { method: "post", action: actionPath })}
            >
              Remove the statuses
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
