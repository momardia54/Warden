import { useEffect, useState } from "react"
import { useFetcher } from "react-router"
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react"
import { FieldLabel, HelpTip } from "#/components/help-tip"
import { StatusBadge } from "#/components/status-badge"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { NativeSelect } from "#/components/ui/native-select"
import { ColorPicker } from "#/components/color-picker"
import { addToSet, DEFAULT_COLOR, findStatus, isColor, keyFromLabel, moveInSet, removeFromSet, updateInSet, type StatusDef, type StatusSet } from "#/lib/statuses"

type Props = {
  statuses: StatusSet
  /** Number of licences per status key, to show usage and to require a replacement when deleting. Not needed for a draft. */
  usage?: Record<string, number>
  /** Route that handles the status intents. The editor saves each change there. */
  actionPath?: string
  /** Edits a set in memory instead of saving it, for a set that does not exist yet (a create form). Receives the changed set. */
  onChange?: (set: StatusSet) => void
}

type Draft = {
  mode: "create" | "edit"
  key: string
  label: string
  description: string
  color: string
  grants_access: boolean
  on_expiry: string
  check_message: string
  is_default: boolean
}

const EMPTY: Draft = { mode: "create", key: "", label: "", description: "", color: DEFAULT_COLOR, grants_access: false, on_expiry: "", check_message: "", is_default: false }

const toDraft = (s: StatusDef): Draft => ({ mode: "edit", key: s.key, label: s.label, description: s.description, color: s.color, grants_access: s.grants_access, on_expiry: s.on_expiry ?? "", check_message: s.check_message, is_default: s.is_default })

/** Lists the statuses of a set and lets you add, change, reorder and delete them. */
export function StatusEditor({ statuses, usage = {}, actionPath, onChange }: Props) {
  const fetcher = useFetcher<{ ok?: true; error?: string } | null>()
  const [localError, setLocalError] = useState("")
  // The dialogs keep their content while they close, so the text does not change during the exit animation.
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editorOpen, setEditorOpen] = useState(false)
  const [keyEdited, setKeyEdited] = useState(false)
  const [removing, setRemoving] = useState<StatusDef | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [moveTo, setMoveTo] = useState("")
  const busy = !onChange && fetcher.state !== "idle"
  const error = onChange ? localError : fetcher.data?.error

  // Close the dialogs once a change has been saved without an error.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setEditorOpen(false)
      setRemoveOpen(false)
    }
  }, [fetcher.state, fetcher.data])

  /** Clears the message of the previous attempt. */
  const clearError = () => {
    fetcher.reset()
    setLocalError("")
  }

  /** Applies a change: saved on the server, or applied to the draft set. */
  function submit(fields: Record<string, string>) {
    if (!onChange) return void fetcher.submit(fields, { method: "post", action: actionPath })
    if (fields.intent === "move-status") return onChange(moveInSet(statuses, fields.key, fields.direction === "up" ? "up" : "down"))
    const change = {
      key: fields.key,
      label: fields.label,
      description: fields.description,
      color: fields.color,
      grants_access: fields.grants_access === "true",
      on_expiry: fields.on_expiry || null,
      check_message: fields.check_message,
      is_default: fields.is_default === "true",
    }
    const result =
      fields.intent === "delete-status" ? removeFromSet(statuses, fields.key) : fields.intent === "create-status" ? addToSet(statuses, change) : updateInSet(statuses, fields.key, change)
    if ("error" in result) return setLocalError(result.error)
    setLocalError("")
    onChange(result.set)
    setEditorOpen(false)
    setRemoveOpen(false)
  }

  function save() {
    submit({
      intent: draft.mode === "create" ? "create-status" : "update-status",
      key: draft.mode === "create" ? draft.key || keyFromLabel(draft.label) : draft.key,
      label: draft.label,
      description: draft.description,
      color: draft.color,
      grants_access: String(draft.grants_access),
      on_expiry: draft.on_expiry,
      check_message: draft.check_message,
      is_default: String(draft.is_default),
    })
  }

  const others = (key: string) => statuses.filter((s) => s.key !== key)

  return (
    <div className="space-y-3">
      {error && !editorOpen && !removeOpen && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <ul className="divide-y rounded-lg border">
        {statuses.map((s, index) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={s} />
                <code className="text-xs text-muted-foreground">{s.key}</code>
                {s.is_default && <Badge variant="outline">Default for new licences</Badge>}
              </div>
              {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
              <p className="text-xs text-muted-foreground">
                {s.grants_access ? "Sites can run" : "Sites are blocked"}
                {s.on_expiry ? ` · becomes ${findStatus(statuses, s.on_expiry)?.label ?? s.on_expiry} when the expiry date passes` : " · expiry date does not apply"}
                {` · ${usage[s.key] ?? 0} licence${(usage[s.key] ?? 0) === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Move ${s.label} up`} disabled={busy || index === 0} onClick={() => submit({ intent: "move-status", key: s.key, direction: "up" })}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Move ${s.label} down`} disabled={busy || index === statuses.length - 1} onClick={() => submit({ intent: "move-status", key: s.key, direction: "down" })}>
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Edit ${s.label}`} onClick={() => {
                  clearError()
                  setDraft(toDraft(s))
                  setEditorOpen(true)
                }}>
                <Pencil className="size-4" />
              </Button>
              <Button type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${s.label}`}
                disabled={statuses.length <= 1}
                onClick={() => {
                  clearError()
                  setRemoving(s)
                  setMoveTo("")
                  setRemoveOpen(true)
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Button type="button"
        variant="outline"
        onClick={() => {
          clearError()
          setDraft(EMPTY)
          setKeyEdited(false)
          setEditorOpen(true)
        }}
      >
        <Plus /> Add status
      </Button>

      <Dialog open={editorOpen} onOpenChange={(open) => !open && !busy && setEditorOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{draft.mode === "create" ? "Add status" : `Edit ${draft.label}`}</DialogTitle>
            <DialogDescription>Statuses describe the state of a licence. The settings below decide what sites see.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="status-label" help="The name shown in the dashboard.">
                  Label
                </FieldLabel>
                <Input
                  id="status-label"
                  value={draft.label}
                  maxLength={40}
                  placeholder="Grace period"
                  onChange={(e) => setDraft({ ...draft, label: e.target.value, key: draft.mode === "create" && !keyEdited ? keyFromLabel(e.target.value) : draft.key })}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="status-key" help="The identifier stored on licences and used in the API. Lowercase letters, digits and underscores. It cannot be changed after the status is created.">
                  Identifier
                </FieldLabel>
                <Input
                  id="status-key"
                  value={draft.key}
                  disabled={draft.mode === "edit"}
                  maxLength={32}
                  placeholder="grace_period"
                  onChange={(e) => {
                    setKeyEdited(true)
                    setDraft({ ...draft, key: e.target.value })
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="status-description" help="Explains the status to you. Shown in the status menu.">
                Description
              </FieldLabel>
              <Input id="status-description" value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="status-color" help="The colour of the status badge. Pick a preset or any colour.">
                Colour
              </FieldLabel>
              <ColorPicker id="status-color" value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="status-expiry" help="What a licence with this status becomes, as seen by sites, once its expiry date has passed. Choose &quot;Nothing&quot; if the expiry date should not apply to this status, for example for a paid-in-full licence.">
                When the expiry date passes
              </FieldLabel>
              <NativeSelect id="status-expiry" value={draft.on_expiry} onChange={(e) => setDraft({ ...draft, on_expiry: e.target.value })}>
                <option value="">Nothing: the expiry date does not apply</option>
                {others(draft.key).map((s) => (
                  <option key={s.key} value={s.key}>
                    Becomes {s.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={draft.grants_access} onChange={(e) => setDraft({ ...draft, grants_access: e.target.checked })} />
                Sites can run under this status
                <HelpTip>When on, the check response says valid: true and the site keeps working. When off, the site is told the licence is not valid and decides what to do, for example show a notice.</HelpTip>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} />
                Default for new licences
                <HelpTip>New licences start with this status unless you choose another. Exactly one status is the default.</HelpTip>
              </label>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="status-message" help="Returned to sites in the check response when a licence with this status has no public message of its own. Optional.">
                Message to sites
              </FieldLabel>
              <Input id="status-message" value={draft.check_message} maxLength={300} placeholder="This licence is on hold." onChange={(e) => setDraft({ ...draft, check_message: e.target.value })} />
            </div>
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={busy || !draft.label.trim() || !isColor(draft.color)}>
              {busy ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={(open) => !open && !busy && setRemoveOpen(false)}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          {removing && (
            <>
              <DialogHeader>
                <DialogTitle>Delete {removing.label}?</DialogTitle>
                <DialogDescription>
                  {(usage[removing.key] ?? 0) > 0
                    ? `${usage[removing.key]} licence${usage[removing.key] === 1 ? "" : "s"} currently use this status. Choose the status they move to.`
                    : "No licence uses this status. File release rules that name it are updated."}
                </DialogDescription>
              </DialogHeader>
              {(usage[removing.key] ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <FieldLabel htmlFor="move-to">Move licences to</FieldLabel>
                  <NativeSelect id="move-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    <option value="">Choose a status</option>
                    {others(removing.key).map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRemoveOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" disabled={busy || ((usage[removing.key] ?? 0) > 0 && !moveTo)} onClick={() => submit({ intent: "delete-status", key: removing.key, move_to: moveTo })}>
                  Delete status
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
