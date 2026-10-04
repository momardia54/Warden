import { Link } from "react-router"
import { Boxes, Plus } from "lucide-react"
import type { Route } from "./+types/apps"
import { PageHeader } from "#/components/page-header"
import { Button } from "#/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { requireAuth } from "~/server/auth.server"
import { listApps } from "~/server/apps.server"

export const meta: Route.MetaFunction = () => [{ title: "Apps | Warden" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return { apps: await listApps(env) }
}

export default function Apps({ loaderData }: Route.ComponentProps) {
  const { apps } = loaderData
  return (
    <>
      <PageHeader crumbs={[{ label: "Apps" }]} />
      <div className="space-y-4 p-4 pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Apps</h1>
            <p className="text-sm text-muted-foreground">Products you license to many customers. Each app has its own licences, defaults and shared releases.</p>
          </div>
          <Button asChild>
            <Link to="/apps/new">
              <Plus /> New app
            </Link>
          </Button>
        </div>

        {apps.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Boxes />
              </EmptyMedia>
              <EmptyTitle>No apps yet</EmptyTitle>
              <EmptyDescription>Create an app for a plugin, theme or any product you sell to several customers. You can still issue standalone licences without one.</EmptyDescription>
            </EmptyHeader>
            <Button asChild>
              <Link to="/apps/new">
                <Plus /> New app
              </Link>
            </Button>
          </Empty>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Licences</TableHead>
                  <TableHead className="hidden sm:table-cell">In force</TableHead>
                  <TableHead className="hidden md:table-cell">Sites</TableHead>
                  <TableHead className="hidden md:table-cell">Latest version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell>
                      <Link to={`/apps/${app.id}`} className="font-medium hover:underline">
                        {app.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{app.description || app.slug}</div>
                    </TableCell>
                    <TableCell>{app.licenses}</TableCell>
                    <TableCell className="hidden sm:table-cell">{app.in_force}</TableCell>
                    <TableCell className="hidden md:table-cell">{app.sites}</TableCell>
                    <TableCell className="hidden md:table-cell">{app.latest_version ? `v${app.latest_version}` : <span className="text-muted-foreground">No release</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  )
}
