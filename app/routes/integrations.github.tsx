import { redirect } from "react-router"
import type { Route } from "./+types/integrations.github"
import { requireAuth } from "~/server/auth.server"
import { STATE_COOKIE } from "#/lib/github-app"
import { completeManifest, getGitHubApp, listAppRepositories } from "~/server/github-app.server"

function readCookie(request: Request, name: string): string {
  const match = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : ""
}

const clearState = (request: Request) => `${STATE_COOKIE}=; Path=/integrations; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`
const back = (request: Request, query: string) => redirect(`/integrations?${query}`, { headers: { "set-cookie": clearState(request) } })

/**
 * Resource routes of the GitHub App (no page):
 *   /integrations/github/callback      GitHub returns here after the app is created (manifest flow): ?code&state
 *   /integrations/github/installed     GitHub returns here after the app is installed or its repositories change
 *   /integrations/github/repositories  JSON: the repositories the app can access, for the repository picker
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const url = new URL(request.url)

  if (params.step === "callback") {
    const state = url.searchParams.get("state") ?? ""
    const expected = readCookie(request, STATE_COOKIE)
    if (!state || !expected || state !== expected) return back(request, "error=state")
    const created = await completeManifest(env, url.searchParams.get("code") ?? "")
    if ("error" in created) return back(request, `error=${encodeURIComponent(created.error)}`)
    // Next step: install the new app on the accounts whose repositories Warden should publish.
    return redirect(`https://github.com/apps/${encodeURIComponent(created.app.slug)}/installations/new`, { headers: { "set-cookie": clearState(request) } })
  }
  if (params.step === "installed") return redirect("/integrations?installed=1")
  if (params.step === "repositories") {
    const app = await getGitHubApp(env)
    if (!app) return Response.json({ error: "No GitHub App is connected." }, { status: 404 })
    const repositories = await listAppRepositories(app)
    return "error" in repositories ? Response.json({ error: repositories.error }, { status: 502 }) : Response.json({ repositories })
  }
  throw new Response("Not found", { status: 404 })
}
