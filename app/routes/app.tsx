import { Outlet, useLoaderData } from "react-router"
import { ShieldAlert } from "lucide-react"
import type { Route } from "./+types/app"
import { AppSidebar } from "#/components/app-sidebar"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar"
import { NavigationProgress } from "#/components/navigation-progress"
import { StatusProvider } from "#/components/status-context"
import { requireAuth, securityWarnings } from "~/server/auth.server"
import { loadStatusSets } from "~/server/statuses.server"

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const session = await requireAuth(request, env)
  return { username: session.username, warnings: securityWarnings(env), statusSets: await loadStatusSets(env) }
}

/**
 * The layout data (user name, password hints, status sets) rarely changes while you click around, so it is only
 * reloaded after a form that edits statuses.
 */
export function shouldRevalidate({ formAction }: { formAction?: string }) {
  return Boolean(formAction && (formAction.startsWith("/statuses") || formAction.startsWith("/apps/")))
}

export default function AppLayout() {
  const { username, warnings, statusSets } = useLoaderData<typeof loader>()

  return (
    <StatusProvider value={statusSets}>
      <SidebarProvider>
        <NavigationProgress />
        <AppSidebar username={username} />
        <SidebarInset>
          {warnings.length > 0 && (
            <Alert variant="destructive" className="mx-4 mt-4 w-auto">
              <ShieldAlert />
              <AlertTitle>Security recommendation</AlertTitle>
              <AlertDescription>{warnings.join(" ")}</AlertDescription>
            </Alert>
          )}
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </StatusProvider>
  )
}
