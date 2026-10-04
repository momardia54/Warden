import { redirect } from "react-router"
import type { Route } from "./+types/logout"
import { destroySession } from "~/server/auth.server"

export async function action({ request, context }: Route.ActionArgs) {
  const cookie = await destroySession(context.cloudflare.env, request)
  return redirect("/login", { headers: { "Set-Cookie": cookie } })
}

export async function loader() {
  return redirect("/login")
}
