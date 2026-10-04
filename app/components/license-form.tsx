import { useState } from "react"
import { Form, Link, useNavigate, useNavigation } from "react-router"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { FieldLabel } from "#/components/help-tip"
import { Textarea } from "#/components/ui/textarea"
import { NativeSelect } from "#/components/ui/native-select"
import { isStatus, STATUSES, STATUS_HINT, STATUS_LABEL } from "#/lib/license"

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
}

export function LicenseForm({ values, apps, error, submitLabel, cancelTo, reloadOnAppChange, appHint }: Props) {
  const busy = useNavigation().state === "submitting"
  const navigate = useNavigate()
  const [status, setStatus] = useState(values.status)
  const [appId, setAppId] = useState(values.app_id)

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
          <FieldLabel htmlFor="status" help="Controls what sites are told when they check this licence. Change it any time. A licence past its expiry date is reported as Expired regardless.">
            Status
          </FieldLabel>
          <NativeSelect id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.filter((s) => s !== "expired").map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{isStatus(status) ? STATUS_HINT[status] : ""}</p>
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="expires" help="The licence is reported as Expired after this date (end of day, UTC). Leave empty for no expiry. Ignored once the status is Completed.">
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
