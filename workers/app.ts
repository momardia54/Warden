import { createRequestHandler } from "react-router"
import { handleCheck } from "../app/server/check.server"
import { pruneActivity } from "../app/server/licenses.server"
import { withDashboardHeaders } from "../app/server/headers.server"
import { initRequestCache } from "../app/server/request-cache.server"
import { ensureMigrated, migrationFailureResponse, type Migration } from "../app/server/migrate.server"

// Migration files are bundled so the Worker can bring an older database up to date by itself.
const migrations: Migration[] = Object.entries(
  import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>
).map(([path, sql]) => ({ name: path.split("/").pop()!, sql }))

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
      /** Per-request CSP nonce for inline scripts. */
      nonce: string
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    try {
      await ensureMigrated(env.DB, migrations)
    } catch (error) {
      return migrationFailureResponse(request, error)
    }

    // Public endpoint that authenticates with the licence key in the address.
    const check = url.pathname.match(/^\/check\/([A-Za-z0-9-]{10,40})\/?$/)
    if (check) return handleCheck(request, env, ctx, check[1].toUpperCase())

    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    // A per-request copy of env: it is the key of the request-scoped cache (see request-cache.server.ts).
    const requestEnv = { ...env } as Env
    initRequestCache(requestEnv, request)
    const response = await requestHandler(request, { cloudflare: { env: requestEnv, ctx, nonce } })
    return withDashboardHeaders(response, request)
  },

  async scheduled(_controller, env, ctx) {
    await ensureMigrated(env.DB, migrations)
    ctx.waitUntil(pruneActivity(env).catch((error) => console.error("Warden prune failed:", error)))
  },
} satisfies ExportedHandler<Env>
