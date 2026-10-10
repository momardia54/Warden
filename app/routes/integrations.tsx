import { useEffect, useRef, useState } from "react"
import { data, Link, useFetcher, useSearchParams } from "react-router"
import { ExternalLink, Github, Plus, Trash2 } from "lucide-react"
import type { Route } from "./+types/integrations"
import { ConfirmAction } from "#/components/confirm-action"
import { FieldLabel } from "#/components/help-tip"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { Ago } from "#/components/time"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { ACCOUNT_PATTERN, appManifest, defaultAppName, manifestTarget, STATE_COOKIE } from "#/lib/github-app"
import { generateSecret } from "#/lib/random"
import { requireAuth } from "~/server/auth.server"
import { getGitHubApp, listInstallations, publicGitHubApp, removeGitHubApp } from "~/server/github-app.server"

export const meta: Route.MetaFunction = () => [{ title: "Integrations | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const app = await getGitHubApp(env)
  const installations = app ? await listInstallations(app) : []
  const used = app ? await env.DB.prepare("SELECT COUNT(*) AS n FROM release_sources WHERE installation_id IS NOT NULL").first<{ n: number }>() : null
  return {
    origin: new URL(request.url).origin,
    app: app ? publicGitHubApp(app) : null,
    installations: Array.isArray(installations) ? installations : [],
    installationsError: Array.isArray(installations) ? null : installations.error,
    sources: used?.n ?? 0,
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const intent = String(form.get("intent"))
  if (intent === "start-github") {
    const organization = String(form.get("organization") ?? "").trim()
    if (organization && !ACCOUNT_PATTERN.test(organization)) return data({ error: "Enter the organisation's name as it appears in its GitHub address." }, { status: 400 })
    const origin = new URL(request.url).origin
    // The state ties GitHub's redirect back to this request; it lives in a cookie for an hour.
    const state = generateSecret(32)
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
    return data(
      { manifest: JSON.stringify(appManifest(origin, String(form.get("name") ?? ""))), target: manifestTarget(organization, state) },
      { headers: { "set-cookie": `${STATE_COOKIE}=${state}; Path=/integrations; HttpOnly; SameSite=Lax; Max-Age=3600${secure}` } },
    )
  }
  if (intent === "remove-github") {
    const removed = await removeGitHubApp(env)
    return "error" in removed ? data({ error: removed.error }, { status: 409 }) : { ok: true as const }
  }
  return data({ error: "Unknown action." }, { status: 400 })
}

const ERRORS: Record<string, string> = {
  state: "GitHub's answer did not match a request from this dashboard, or it took longer than an hour. Start again.",
}

export default function Integrations({ loaderData, actionData }: Route.ComponentProps) {
  const { origin, app, installations, installationsError, sources } = loaderData
  const [params] = useSearchParams()
  const error = params.get("error")
  const removeError = actionData && "error" in actionData ? actionData.error : null
  const [removing, setRemoving] = useState(false)

  return (
    <>
      <PageHeader crumbs={[{ label: "Integrations" }]} />
      <div className="max-w-4xl space-y-6 p-4 pt-0 lg:px-6">
        <PageTitle title="Integrations" description="Services Warden connects to." />

        {error && (
          <Alert variant="destructive">
            <AlertTitle>GitHub was not connected</AlertTitle>
            <AlertDescription>{ERRORS[error] ?? error}</AlertDescription>
          </Alert>
        )}
        {params.get("installed") && app && (
          <Alert>
            <AlertTitle>GitHub App installed</AlertTitle>
            <AlertDescription>Connect a repository from the Releases tab of an app or a licence: the repositories the app can access are listed there.</AlertDescription>
          </Alert>
        )}
        {removeError && (
          <Alert variant="destructive">
            <AlertTitle>The GitHub App was not removed</AlertTitle>
            <AlertDescription>{removeError}</AlertDescription>
          </Alert>
        )}

        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Github className="mt-0.5 size-5" />
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 font-medium">GitHub {app ? <Badge variant="success">Connected</Badge> : <Badge variant="secondary">Not connected</Badge>}</h2>
                <p className="max-w-prose text-sm text-muted-foreground">
                  Publish version tags of your repositories as releases. Warden uses a GitHub App of its own: repositories are picked from a list, private ones included, with no token or webhook to
                  copy.
                </p>
              </div>
            </div>
          </div>

          {app ? <ConnectedApp app={app} installations={installations} installationsError={installationsError} sources={sources} onRemove={() => setRemoving(true)} /> : <CreateApp origin={origin} />}
        </section>

        <ConfirmAction
          intent="remove-github"
          open={removing}
          onOpenChange={setRemoving}
          title="Remove the GitHub App from Warden?"
          description="Warden forgets the app's credentials. Delete the app on GitHub as well, under the app's settings, Advanced. Repositories connected with an access token are not affected."
          confirm="Remove"
        />
      </div>
    </>
  )
}

function CreateApp({ origin }: { origin: string }) {
  const start = useFetcher<{ manifest?: string; target?: string; error?: string }>()
  const [owner, setOwner] = useState<"personal" | "organization">("personal")
  const [organization, setOrganization] = useState("")
  const [name, setName] = useState(() => defaultAppName(origin))
  const form = useRef<HTMLFormElement>(null)

  // The manifest must be posted to GitHub by the browser, so the action returns it and the page submits it.
  useEffect(() => {
    if (start.state === "idle" && start.data?.manifest && form.current) form.current.submit()
  }, [start.state, start.data])

  const busy = start.state !== "idle" || Boolean(start.data?.manifest)
  return (
    <div className="space-y-4 border-t pt-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground marker:text-muted-foreground">
        <li>GitHub shows the app Warden needs: read access to repository contents and metadata, and push events. Confirm it.</li>
        <li>Install the app on your account or organisation, for all repositories or selected ones.</li>
        <li>Back in Warden, connect a repository from the Releases tab of an app or a licence.</li>
      </ol>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="github-app-name" help="App names are unique across GitHub. You can change it on GitHub before confirming.">
            App name
          </FieldLabel>
          <Input id="github-app-name" value={name} maxLength={34} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel help="The account that owns the app. An organisation's app can be managed by its other owners.">Owner</FieldLabel>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="github-owner" className="accent-primary" checked={owner === "personal"} onChange={() => setOwner("personal")} disabled={busy} />
              My personal account
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="github-owner" className="accent-primary" checked={owner === "organization"} onChange={() => setOwner("organization")} disabled={busy} />
              An organisation
            </label>
          </div>
          {owner === "organization" && (
            <Input aria-label="Organisation" placeholder="harbor-studio" value={organization} onChange={(e) => setOrganization(e.target.value)} className="font-mono" disabled={busy} />
          )}
        </div>
      </div>
      {start.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{start.data.error}</div>}
      <Button
        disabled={busy || (owner === "organization" && !organization.trim())}
        onClick={() => start.submit({ intent: "start-github", name, organization: owner === "organization" ? organization.trim() : "" }, { method: "post" })}
      >
        <Github /> {busy ? "Opening GitHub…" : "Create GitHub App"}
      </Button>
      {start.data?.manifest && start.data.target && (
        <form ref={form} method="post" action={start.data.target} className="hidden">
          <input type="hidden" name="manifest" value={start.data.manifest} />
        </form>
      )}
    </div>
  )
}

type AppView = { slug: string; name: string; owner: string; html_url: string; created_at: number; last_delivery_at: number | null }
type InstallationView = { id: number; account: string; account_type: string; repository_selection: "all" | "selected"; html_url: string }

function ConnectedApp({
  app,
  installations,
  installationsError,
  sources,
  onRemove,
}: {
  app: AppView
  installations: InstallationView[]
  installationsError: string | null
  sources: number
  onRemove: () => void
}) {
  const installUrl = `https://github.com/apps/${app.slug}/installations/new`
  return (
    <div className="space-y-4 border-t pt-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">App</dt>
        <dd>
          <a href={app.html_url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
            {app.name}
          </a>
          {app.owner && <span className="text-muted-foreground">, owned by {app.owner}</span>}
        </dd>
        <dt className="text-muted-foreground">Repositories in use</dt>
        <dd>{sources === 0 ? "None yet" : `${sources} connected to apps or licences`}</dd>
        <dt className="text-muted-foreground">Last webhook delivery</dt>
        <dd>
          <Ago ts={app.last_delivery_at} empty="none yet" />
        </dd>
      </dl>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Installations</h3>
        {installationsError ? (
          <p className="text-sm text-destructive">{installationsError}</p>
        ) : installations.length === 0 ? (
          <p className="text-sm text-muted-foreground">The app is not installed yet. Install it on the account or organisation that owns your repositories.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {installations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{i.account}</span>{" "}
                  <span className="text-muted-foreground">
                    ({i.account_type === "Organization" ? "organisation" : "personal account"}), {i.repository_selection === "all" ? "all repositories" : "selected repositories"}
                  </span>
                </span>
                <a href={i.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline">
                  Configure on GitHub <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={installUrl}>
            <Plus /> {installations.length === 0 ? "Install the app" : "Install on another account"}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={app.html_url} target="_blank" rel="noreferrer">
            <ExternalLink /> App settings on GitHub
          </a>
        </Button>
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onRemove}>
          <Trash2 /> Remove from Warden
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Repositories are connected on the{" "}
        <Link to="/apps" className="underline underline-offset-2">
          Releases tab of an app
        </Link>{" "}
        or a licence.
      </p>
    </div>
  )
}
