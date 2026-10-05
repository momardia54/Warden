import { useState } from "react"
import { Form, Link, useNavigate, useNavigation } from "react-router"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { FieldLabel } from "#/components/help-tip"
import { Textarea } from "#/components/ui/textarea"
import { NativeSelect } from "#/components/ui/native-select"
import { useStatusSetForLicense } from "#/components/status-context"
import { StatusDraft } from "#/components/status-draft"
import { defaultStatusKey, findStatus, type StatusSet } from "#/lib/statuses"

export type FormValues = {
  name: string
  customer_name: string
  customer_email: string
  app_id: string
  status: string
  expires: string
  max_sites: string
  domains: string
  message: string
  notes: string
}

export const EMPTY_FORM: FormValues = { name: "", customer_name: "", customer_email: "", app_id: "", status: "active", expires: "", max_sites: "", domains: "", message: "", notes: "" }

export type AppOption = { id: string; name: string }

type Props = {
  values: FormValues
  apps: AppOption[]
  error?: string
  submitLabel: string
  cancelTo: string
  /** On the "new licence" page, choosing an app reloads the page so the app's defaults can be applied. */
  reloadOnAppChange?: boolean
  /** Describes the defaults applied from the selected app. */
  appHint?: string
  /** The licence being edited, which may have statuses of its own. */
  licenseId?: string
  /** Offer to customise the statuses of the licence being created. */
  allowStatusCustomisation?: boolean
}

export function LicenseForm({ values, apps, error, submitLabel, cancelTo, reloadOnAppChange, appHint, licenseId = "", allowStatusCustomisation = false }: Props) {
  const busy = useNavigation().state === "submitting"
  const navigate = useNavigate()
  const [status, setStatus] = useState(values.status)
  const [appId, setAppId] = useState(values.app_id)
  // The statuses available depend on the licence and its app: either can have its own set.
  const inherited = useStatusSetForLicense({ id: licenseId, app_id: appId || null })
  // Statuses being drafted for a licence that does not exist yet. They replace the inherited ones for this form.
  const [draft, setDraft] = useState<StatusSet | null>(null)
  const statuses = draft ?? inherited

  return (
    <Form method="post" className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <FieldLabel htmlFor="app_id" help="The app (product) this licence is for. A licence under an app starts with the app's default duration, status, message and site limit, and can download the app's shared files. Leave empty for a standalone licence.">
          App
        </FieldLabel>
        <NativeSelect
          id="app_id"
          name="app_id"
          value={appId}
          onChange={(e) => {
            setAppId(e.target.value)
            // Keep the status if the new app has it, otherwise fall back to that app's default.
            if (!findStatus(statuses, status)) setStatus(defaultStatusKey(statuses))
            if (reloadOnAppChange) navigate(e.target.value ? `?app=${e.target.value}` : "?", { replace: true })
          }}
        >
          <option value="">No app (standalone licence)</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </NativeSelect>
        {appHint && <p className="text-xs text-muted-foreground">{appHint}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel htmlFor="name" help="An internal name to recognise the licence, for example the site or the order.">
            Name
          </FieldLabel>
          <Input id="name" name="name" required autoFocus defaultValue={values.name} placeholder="Harbor Studio website" />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="customer_name" help="Who the licence was issued to. Optional; searchable in the licence list.">
            Customer
          </FieldLabel>
          <Input id="customer_name" name="customer_name" defaultValue={values.customer_name} placeholder="Harbor Studio" />
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="customer_email" help="Contact address of the customer. Optional. For your reference only; Warden does not send email.">
          Customer email
        </FieldLabel>
        <Input id="customer_email" name="customer_email" type="email" defaultValue={values.customer_email} placeholder="billing@harborstudio.com" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel htmlFor="status" help="Controls what sites are told when they check this licence. Change it any time. Statuses can be customised on the Statuses page. A status can have an expiry rule, for example Active becoming Expired after the expiry date.">
            Status
          </FieldLabel>
          <NativeSelect id="status" name="status" value={findStatus(statuses, status) ? status : defaultStatusKey(statuses)} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{findStatus(statuses, status)?.description ?? ""}</p>
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="expires" help="After this date (end of day, UTC) a licence whose status has an expiry rule, such as Active, is reported with the status that rule points to, such as Expired. Leave empty for no expiry. Statuses without an expiry rule, such as Completed, ignore it.">
            Expiry date
          </FieldLabel>
          <Input id="expires" name="expires_at" type="date" key={values.expires} defaultValue={values.expires} />
          <p className="text-xs text-muted-foreground">Optional. Leave empty for no expiry.</p>
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="max_sites" help="How many different sites (domains) may use this licence. Each site registers automatically on its first successful check; further sites are refused once the limit is reached. You can release a site on the licence page to free its slot.">
          Maximum sites
        </FieldLabel>
        <Input id="max_sites" name="max_sites" type="number" min={1} step={1} key={values.max_sites} defaultValue={values.max_sites} placeholder="Unlimited" className="max-w-40" />
        <p className="text-xs text-muted-foreground">Optional. Leave empty for unlimited.</p>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="domains" help="A fixed list of domains this licence is restricted to. A site sends its domain as ?domain= when it checks. Subdomains of an allowed domain match. Leave empty to allow any domain (within the site limit).">
          Allowed domains
        </FieldLabel>
        <Input id="domains" name="domains" defaultValue={values.domains} placeholder="harborstudio.com, staging.harborstudio.com" />
        <p className="text-xs text-muted-foreground">Comma separated. Optional.</p>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="message" help="Returned to the site in the check response as the message field. Your site can show it when the licence is not valid, for example a payment reminder. Visible to anyone with the licence key.">
          Public message
        </FieldLabel>
        <Input id="message" name="message" key={values.message} defaultValue={values.message} placeholder="Payment overdue. Please contact support." maxLength={300} />
        <p className="text-xs text-muted-foreground">Optional. Returned to the site in the check response.</p>
      </div>

      {allowStatusCustomisation && (
        <StatusDraft
          owner="licence"
          inherited={inherited}
          inheritedFrom={appId ? `the statuses of ${apps.find((a) => a.id === appId)?.name ?? "its app"}` : "the default statuses"}
          value={draft}
          onChange={(set) => {
            setDraft(set)
            // The chosen status must exist in the statuses the licence will have.
            const next = set ?? inherited
            if (!findStatus(next, status)) setStatus(defaultStatusKey(next))
          }}
        />
      )}

      <div className="space-y-2">
        <FieldLabel htmlFor="notes" help="For your own reference. Never returned by the check endpoint or the download endpoint.">
          Internal notes
        </FieldLabel>
        <Textarea id="notes" name="notes" rows={4} defaultValue={values.notes} placeholder="Payment plan, contact details, agreement reference" />
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
