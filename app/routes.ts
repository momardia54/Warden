import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // Raw file upload from the dashboard (a resource route: no page).
  route("licenses/:licenseId/files", "routes/licenses.$licenseId.files.tsx"),
  layout("routes/app.tsx", [
    route("overview", "routes/overview.tsx"),
    route("licenses", "routes/licenses.tsx"),
    route("licenses/new", "routes/licenses.new.tsx"),
    route("licenses/:licenseId", "routes/licenses.$licenseId.tsx"),
    route("licenses/:licenseId/edit", "routes/licenses.$licenseId.edit.tsx"),
    route("api-keys", "routes/api-keys.tsx"),
  ]),
] satisfies RouteConfig
