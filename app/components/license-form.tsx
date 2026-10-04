import { useState } from "react"
import { Form, Link, useNavigation } from "react-router"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { FieldLabel } from "#/components/help-tip"
import { Textarea } from "#/components/ui/textarea"
import { NativeSelect } from "#/components/ui/native-select"
import { isStatus, STATUSES, STATUS_HINT, STATUS_LABEL } from "#/lib/license"

export type FormValues = { name: string; client: string; status: string; expires: string; domains: string; message: string; notes: string }

export const EMPTY_FORM: FormValues = { name: "", client: "", status: "active", expires: "", domains: "", message: "", notes: "" }

export function LicenseForm({ values, error, submitLabel, cancelTo }: { values: FormValues; error?: string; submitLabel: string; cancelTo: string }) {
  const busy = useNavigation().state === "submitting"
  const [status, setStatus] = useState(values.status)
  return (
    <Form method="post" className="max-w-2xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel htmlFor="name" help="An internal name to recognise the licence, for example the site or project.">Name</FieldLabel>
          <Input id="name" name="name" required autoFocus defaultValue={values.name} placeholder="Harbor Studio website" />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="client" help="The customer this licence belongs to. Optional; searchable in the licence list.">Client</FieldLabel>
          <Input id="client" name="client" defaultValue={values.client} placeholder="Harbor Studio" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel htmlFor="status" help="Controls what sites are told when they check this licence. Change it any time. A licence past its expiry date is reported as Expired regardless.">Status</FieldLabel>
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
          <FieldLabel htmlFor="expires" help="The licence is reported as Expired after this date (end of day, UTC). Leave empty for no expiry. Ignored once the status is Completed.">Expiry date</FieldLabel>
          <Input id="expires" name="expires_at" type="date" defaultValue={values.expires} />
          <p className="text-xs text-muted-foreground">Optional. Leave empty for no expiry.</p>
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="domains" help="Restricts the licence to these domains. A site sends its domain as ?domain= when it checks. Subdomains of an allowed domain match. Leave empty to allow any domain.">Allowed domains</FieldLabel>
        <Input id="domains" name="domains" defaultValue={values.domains} placeholder="harborstudio.com, staging.harborstudio.com" />
        <p className="text-xs text-muted-foreground">Comma separated. Optional. Leave empty to allow any domain.</p>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="message" help="Returned to the site in the check response as the message field. Your site can show it when the licence is not valid, for example a payment reminder. Visible to anyone with the licence key.">Public message</FieldLabel>
        <Input id="message" name="message" defaultValue={values.message} placeholder="Payment overdue. Please contact support." maxLength={300} />
        <p className="text-xs text-muted-foreground">Optional. Returned to the site in the check response.</p>
      </div>

      <div className="space-y-2">
        <FieldLabel htmlFor="notes" help="For your own reference. Never returned by the check endpoint or the download endpoint.">Internal notes</FieldLabel>
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
