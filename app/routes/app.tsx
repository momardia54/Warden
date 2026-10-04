import { Outlet, useLoaderData } from "react-router"
import { ShieldAlert } from "lucide-react"
import type { Route } from "./+types/app"
import { AppSidebar } from "#/components/app-sidebar"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar"
import { NavigationProgress } from "#/components/navigation-progress"
import { requireAuth, securityWarnings } from "~/server/auth.server"

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const session = await requireAuth(request, env)
  return { username: session.username, warnings: securityWarnings(env) }
}

/** The sidebar only shows the user name and password hints, which never change while you click around. */
export function shouldRevalidate() {
  return false
}

export default function AppLayout() {
  const { username, warnings } = useLoaderData<typeof loader>()

  return (
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
  )
}
