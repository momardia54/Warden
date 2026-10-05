import { HelpTip } from "#/components/help-tip"
import { StatusEditor } from "#/components/status-editor"
import { Button } from "#/components/ui/button"
import type { StatusSet } from "#/lib/statuses"

type Props = {
  /** What is being created: "app" or "licence". */
  owner: "app" | "licence"
  /** The statuses it uses unless customised: the app's or the defaults for a licence, the defaults for an app. */
  inherited: StatusSet
  /** Where those come from, for the text, for example "the default statuses" or "the statuses of the app Harbor Theme". */
  inheritedFrom: string
  /** The customised statuses being drafted, or null when the inherited ones are used. */
  value: StatusSet | null
  onChange: (set: StatusSet | null) => void
}

/**
 * The statuses section of a create form. Nothing is saved until the form is submitted: the draft travels with the form
 * as JSON and is stored together with the new app or licence.
 */
export function StatusDraft({ owner, inherited, inheritedFrom, value, onChange }: Props) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          Statuses{" "}
          <HelpTip>
            {owner === "app"
              ? "The statuses licences of this app can have. By default an app uses the default statuses. Customise them to give this app its own, for example a Trial status."
              : "The statuses of this licence. By default it uses its app's statuses, or the default statuses. Customise them to give this licence its own."}
          </HelpTip>
        </h2>
        <p className="text-xs text-muted-foreground">
          {value ? `This ${owner} will have its own statuses.` : `This ${owner} will use ${inheritedFrom}.`} You can also customise them later from the {owner} page.
        </p>
      </div>
      {value ? (
        <>
          <StatusEditor statuses={value} onChange={(set) => onChange(set)} />
          <input type="hidden" name="statuses_json" value={JSON.stringify(value)} />
          <Button type="button" variant="outline" onClick={() => onChange(null)}>
            Use {inheritedFrom} instead
          </Button>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {inherited.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => onChange(inherited.map((s) => ({ ...s })))}>
            Customise statuses for this {owner}
          </Button>
        </div>
      )}
    </section>
  )
}
