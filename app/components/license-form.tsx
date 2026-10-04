import { Form, Link, useNavigation } from "react-router"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { NativeSelect } from "#/components/ui/native-select"
import { STATUSES, STATUS_HINT, STATUS_LABEL } from "#/lib/license"

export type FormValues = { name: string; client: string; status: string; expires: string; domains: string; message: string; notes: string }

export const EMPTY_FORM: FormValues = { name: "", client: "", status: "active", expires: "", domains: "", message: "", notes: "" }

export function LicenseForm({ values, error, submitLabel, cancelTo }: { values: FormValues; error?: string; submitLabel: string; cancelTo: string }) {
  const busy = useNavigation().state === "submitting"
  return (
    <Form method="post" className="max-w-2xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Licence name</Label>
          <Input id="name" name="name" required autoFocus defaultValue={values.name} placeholder="OCWOF website" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client">Client (optional)</Label>
          <Input id="client" name="client" defaultValue={values.client} placeholder="Ocean Conservation Waves of Freedom" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={values.status}>
            {STATUSES.filter((s) => s !== "expired").map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{STATUS_HINT.pending} {STATUS_HINT.suspended}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="expires">End date (optional)</Label>
          <Input id="expires" name="expires_at" type="date" defaultValue={values.expires} />
          <p className="text-xs text-muted-foreground">After this day the licence reports &ldquo;expired&rdquo; by itself. Leave empty for no end date.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="domains">Allowed domains (optional)</Label>
        <Input id="domains" name="domains" defaultValue={values.domains} placeholder="ocwof.org, staging.ocwof.org" />
        <p className="text-xs text-muted-foreground">
          If set, the check only says &ldquo;valid&rdquo; when the site sends one of these in <code>?domain=</code>. Subdomains match.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">Message for the site (optional)</Label>
        <Input id="message" name="message" defaultValue={values.message} placeholder="Payment overdue, contact m@getpurevibe.com" maxLength={300} />
        <p className="text-xs text-muted-foreground">Returned as <code>message</code> in the check answer. Your site can show it when the licence is not active.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Private notes (optional)</Label>
        <Textarea id="notes" name="notes" rows={4} defaultValue={values.notes} placeholder="Payment plan: $300 + 8 x $150. Never sent to the site." />
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
