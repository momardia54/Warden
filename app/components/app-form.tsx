import { useState } from "react"
import { Form, Link, useNavigation } from "react-router"
import { FieldLabel } from "#/components/help-tip"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { NativeSelect } from "#/components/ui/native-select"
import { Textarea } from "#/components/ui/textarea"
import { slugify } from "#/lib/apps"
import { StatusDraft } from "#/components/status-draft"
import { defaultStatusKey, findStatus, type StatusSet } from "#/lib/statuses"

export type AppFormValues = {
  name: string
  slug: string
  description: string
  default_status: string
  default_duration_days: string
  default_max_sites: string
  default_message: string
  notes: string
}

export const EMPTY_APP_FORM: AppFormValues = { name: "", slug: "", description: "", default_status: "active", default_duration_days: "", default_max_sites: "", default_message: "", notes: "" }

export function AppForm({ values, statuses: inherited, error, submitLabel, cancelTo, allowStatusCustomisation = false }: { values: AppFormValues; statuses: StatusSet; error?: string; submitLabel: string; cancelTo: string; allowStatusCustomisation?: boolean }) {
  const busy = useNavigation().state === "submitting"
  const [name, setName] = useState(values.name)
  const [slug, setSlug] = useState(values.slug)
  // The identifier follows the name until it is edited by hand.
  const [slugEdited, setSlugEdited] = useState(values.slug !== "")
  // Statuses being drafted for an app that does not exist yet. They replace the default statuses for this form.
  const [draft, setDraft] = useState<StatusSet | null>(null)
  const statuses = draft ?? inherited
  const [defaultStatus, setDefaultStatus] = useState(values.default_status)

  return (
    <Form method="post" className="max-w-2xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel htmlFor="name" help="The name of the product you license, for example a plugin or a theme.">
            Name
          </FieldLabel>
          <Input
            id="name"
            name="name"
            required
            autoFocus
            value={name}
            placeholder="Harbor Theme"
            onChange={(e) => {
              setName(e.target.value)
              if (!slugEdited) setSlug(slugify(e.target.value))
            }}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="slug" help="A short identifier used in the API and in links: lowercase letters, digits and hyphens. It is generated from the name and can be changed.">
            Identifier
          </FieldLabel>
          <Input
            id="slug"
            name="slug"
            value={slug}
            placeholder="harbor-theme"
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugEdited(true)
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="description" help="Shown on the app page. Optional.">
          Description
        </FieldLabel>
        <Input id="description" name="description" defaultValue={values.description} placeholder="Premium WordPress theme for studios" maxLength={500} />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-semibold">Defaults for new licences</h2>
          <p className="text-xs text-muted-foreground">Applied when you issue a licence under this app, in the dashboard or through the API. Each one can be changed per licence.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <FieldLabel htmlFor="default_status" help="The status a new licence starts with. Use Pending to hold a licence until payment is confirmed.">
              Status
            </FieldLabel>
            <NativeSelect id="default_status" name="default_status" value={findStatus(statuses, defaultStatus) ? defaultStatus : defaultStatusKey(statuses)} onChange={(e) => setDefaultStatus(e.target.value)}>
              {statuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="default_duration_days" help="How many days a new licence is valid, counted from the day it is issued. Leave empty for licences that do not expire.">
              Duration (days)
            </FieldLabel>
            <Input id="default_duration_days" name="default_duration_days" type="number" min={1} step={1} defaultValue={values.default_duration_days} placeholder="No expiry" />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="default_max_sites" help="How many different sites (domains) one licence may be used on. Leave empty for unlimited.">
              Maximum sites
            </FieldLabel>
            <Input id="default_max_sites" name="default_max_sites" type="number" min={1} step={1} defaultValue={values.default_max_sites} placeholder="Unlimited" />
          </div>
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="default_message" help="The public message new licences start with. Returned to sites in the check response.">
            Public message
          </FieldLabel>
          <Input id="default_message" name="default_message" defaultValue={values.default_message} placeholder="Optional" maxLength={300} />
        </div>
      </div>

      {allowStatusCustomisation && (
        <StatusDraft
          owner="app"
          inherited={inherited}
          inheritedFrom="the default statuses"
          value={draft}
          onChange={(set) => {
            setDraft(set)
            if (!findStatus(set ?? inherited, defaultStatus)) setDefaultStatus(defaultStatusKey(set ?? inherited))
          }}
        />
      )}

      <div className="space-y-2">
        <FieldLabel htmlFor="notes" help="For your own reference. Never returned by the check or download endpoints.">
          Internal notes
        </FieldLabel>
        <Textarea id="notes" name="notes" rows={3} defaultValue={values.notes} />
      </div>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : submitLabel}
        </Button>
        <Button asChild variant="outline">
          <Link to={cancelTo}>Cancel</Link>
        </Button>
      </div>
    </Form>
  )
}
