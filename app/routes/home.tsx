import { redirect } from "react-router"
import type { Route } from "./+types/home"
import { getSession } from "~/server/auth.server"

export async function loader({ context, request }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env)
  return redirect(session ? "/overview" : "/login")
}
