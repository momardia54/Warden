import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router"
import { KeyRound, RefreshCw, Terminal } from "lucide-react"
import type { Route } from "./+types/login"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { workerNameFromHost } from "#/lib/worker-name"
import { CodeBlock, InlineCode } from "#/components/code-block"
import {
  authConfigured,
  checkCredentials,
  clearLoginFailures,
  createSession,
  globalFailureDelay,
  getSession,
  isLoginThrottled,
  recordLoginFailure,
} from "~/server/auth.server"

export const meta: Route.MetaFunction = () => [
  { title: "Login | Warden" },
  { name: "description", content: "Sign in to your Warden dashboard" },
]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  if (await getSession(request, env)) throw redirect("/overview")

  const missing = [
    !env.ADMIN_USERNAME?.trim() && "ADMIN_USERNAME",
    !env.ADMIN_PASSWORD && "ADMIN_PASSWORD",
  ].filter(Boolean) as string[]

  const workerName = workerNameFromHost(new URL(request.url).hostname)

  return { configured: authConfigured(env), missing, workerName }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  if (!authConfigured(env)) return { error: "ADMIN_USERNAME and ADMIN_PASSWORD are not configured." }

  if (await isLoginThrottled(request, env)) {
    return { error: "Too many failed attempts. Try again in 15 minutes." }
  }

  const form = await request.formData()
  const username = String(form.get("username") ?? "").trim()
  const password = String(form.get("password") ?? "")
  if (username.length > 200 || password.length > 1024) {
    await recordLoginFailure(request, env)
    return { error: "Invalid username or password" }
  }

  await globalFailureDelay(env)
  if (!(await checkCredentials(env, username, password))) {
    await recordLoginFailure(request, env)
    return { error: "Invalid username or password" }
  }

  await clearLoginFailures(request, env)
  return redirect("/overview", { headers: { "Set-Cookie": await createSession(env, request) } })
}

function SetupRequired({ missing, workerName }: { missing: string[]; workerName: string | null }) {
  const target = workerName ?? "<your-worker-name>"
  const commands = `npx wrangler secret put ADMIN_USERNAME --name ${target}
npx wrangler secret put ADMIN_PASSWORD --name ${target}`

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-12 rounded-xl" />
          <h1 className="text-3xl font-bold">One last step</h1>
          <p className="mt-2 text-muted-foreground">
            Warden is deployed and running. It has no default login, so add your admin{" "}
            {missing.length === 1 ? "variable" : "username and password"} to the Worker to sign in.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-3 text-sm">
          <span className="font-medium">Not set yet:</span>{" "}
          {missing.map((m) => (
            <span key={m} className="mr-1.5">
              <InlineCode>{m}</InlineCode>
            </span>
          ))}
          <span className="text-muted-foreground">
            (Your build did not fail because of this. These are runtime variables, added after deploying.)
          </span>
        </div>

        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4" /> Option 1: Cloudflare dashboard
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Open the{" "}
              <a className="text-foreground underline underline-offset-2" href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">
                Cloudflare dashboard
              </a>{" "}
              and go to <span className="text-foreground">Workers &amp; Pages</span> → <span className="text-foreground">{workerName ?? "your Warden Worker"}</span>.
            </li>
            <li>
              Open <span className="text-foreground">Settings</span> → <span className="text-foreground">Variables and Secrets</span> (not the &ldquo;Build&rdquo; section, which is only for build time).
            </li>
            <li>
              Click <span className="text-foreground">Add</span>, choose type <span className="text-foreground">Secret</span>, and create{" "}
              {missing.map((m, i) => (
                <span key={m}>
                  {i > 0 && " and "}
                  <InlineCode>{m}</InlineCode>
                </span>
              ))}
              . Use a long random password (12+ characters).
            </li>
            <li>
              Click <span className="text-foreground">Deploy</span> to apply them. A new version goes live within seconds and no rebuild is needed.
            </li>
          </ol>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Terminal className="size-4" /> Option 2: command line
          </h2>
          <p className="text-sm text-muted-foreground">
            Run these anywhere you are logged in with <InlineCode>npx wrangler login</InlineCode>. Each command asks for the value and stores it as an encrypted secret.
          </p>
          <CodeBlock code={commands} language="bash" />
          {!workerName && (
            <p className="text-xs text-muted-foreground">Replace the placeholder with your Worker&apos;s name as shown in the dashboard.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Optional but recommended: <InlineCode>SESSION_SECRET</InlineCode>, any random 32+ character string (<InlineCode>openssl rand -hex 32</InlineCode>).
          </p>
        </section>

        <div className="text-center">
          <Button asChild variant="outline">
            <a href="/login">
              <RefreshCw className="size-4" /> I&apos;ve added them, check again
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const { configured, missing, workerName } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  if (!configured) return <SetupRequired missing={missing} workerName={workerName} />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-12 rounded-xl" />
          <h1 className="text-3xl font-bold">Welcome Back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to manage your licences</p>
        </div>

        <Form method="post" className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                required
                autoFocus
                placeholder="admin"
                autoComplete="username"
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                placeholder="Your password"
                autoComplete="current-password"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {actionData?.error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionData.error}</div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing In..." : "Sign In"}
          </Button>
        </Form>
      </div>
    </div>
  )
}
