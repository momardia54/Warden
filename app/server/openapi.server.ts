/** OpenAPI 3.1 description of the API, served at /api/v1/openapi.json. */
export function openApiSpec(origin: string) {
  const idParam = { name: "id", in: "path", required: true, description: "Licence id (lic_...) or the licence key (WRD-...).", schema: { type: "string" } }
  const ok = (description: string, ref = "License") => ({ description, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } })
  const err = { $ref: "#/components/responses/Error" }
  const body = (schema: object) => ({ required: true, content: { "application/json": { schema } } })
  const secured = [{ bearer: [] }]
  const appParam = { name: "app", in: "path", required: true, description: "App id (app_...) or slug.", schema: { type: "string" } }

  return {
    openapi: "3.1.0",
    info: {
      title: "Warden API",
      version: "0.1.0",
      description:
        "Create and manage licences from your own code. Authenticate with an API key created in the dashboard (API keys page): `Authorization: Bearer wk_...`. Scopes: `read` (GET), `manage` (also create, edit, status, renew), `full` (also delete and regenerate keys).",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: secured,
    paths: {
      "/me": { get: { summary: "Who the key belongs to", responses: { 200: { description: "Key name and scope" }, 401: err } } },
      "/stats": { get: { summary: "Counts by status", responses: { 200: { description: "Totals, counts per status, licences ending in 14 days, active licences not checked for 3 days" }, 401: err } } },
      "/licenses": {
        get: {
          summary: "List licences",
          description: "Newest first. Pass `before` = the `next` value of the previous page to continue.",
          parameters: [
            { name: "status", in: "query", schema: { enum: ["pending", "active", "completed", "suspended", "disabled", "expired"] } },
            { name: "q", in: "query", description: "Search name, customer, key, domains, external_ref and app name", schema: { type: "string" } },
            { name: "app", in: "query", description: "Only licences of this app (id or slug)", schema: { type: "string" } },
            { name: "external_ref", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
            { name: "before", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "A page of licences: { data: License[], next: string | null }" }, 401: err },
        },
        post: {
          summary: "Create a licence",
          description: "With `external_ref`, creating twice returns the first licence (HTTP 200, header `Idempotent-Replayed: true`) instead of a duplicate, so retries and repeated webhooks are safe.",
          requestBody: body({ $ref: "#/components/schemas/LicenseInput" }),
          responses: { 201: ok("Created"), 200: ok("Already existed (same external_ref)"), 401: err, 403: err, 422: err },
        },
      },
      "/licenses/{id}": {
        parameters: [idParam],
        get: { summary: "Get a licence", responses: { 200: ok("The licence"), 401: err, 404: err } },
        patch: { summary: "Edit a licence (only the fields you send)", requestBody: body({ $ref: "#/components/schemas/LicenseInput" }), responses: { 200: ok("Updated"), 401: err, 403: err, 404: err, 422: err } },
        delete: { summary: "Delete a licence and its history (scope full)", responses: { 200: { description: "{ deleted: true, id }" }, 401: err, 403: err, 404: err } },
      },
      "/licenses/{id}/status": {
        parameters: [idParam],
        post: { summary: "Set the status", requestBody: body({ type: "object", required: ["status"], properties: { status: { enum: ["pending", "active", "completed", "suspended", "disabled"] } } }), responses: { 200: ok("Updated"), 403: err, 404: err, 422: err } },
      },
      "/licenses/{id}/renew": {
        parameters: [idParam],
        post: {
          summary: "Renew",
          description: "`days` moves the end date forward (from the current end date, or from today if it has passed). `until` sets the end date. A licence that had expired becomes active again; a suspended or disabled one keeps its status.",
          requestBody: body({ type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 3650 }, until: { type: "string", description: "YYYY-MM-DD or ISO date-time, in the future" } } }),
          responses: { 200: ok("Renewed"), 403: err, 404: err, 422: err },
        },
      },
      "/licenses/{id}/regenerate-key": { parameters: [idParam], post: { summary: "Replace the key (scope full). The old key and check URL stop working.", responses: { 200: ok("Updated, with the new key"), 403: err, 404: err } } },
      "/licenses/{id}/files": {
        parameters: [idParam],
        get: { summary: "List the files attached to a licence", responses: { 200: { description: "{ data: File[] }" }, 404: err } },
        put: {
          summary: "Upload a file (permission: manage)",
          description:
            "The request body is the raw file, not multipart, and the request needs a Content-Length header. Maximum size 100 MB. The file can be downloaded while the licence status is one of `statuses`.",
          parameters: [
            { name: "name", in: "query", required: true, description: "Download file name", schema: { type: "string" } },
            { name: "statuses", in: "query", description: "Comma separated licence statuses in which the file is available", schema: { type: "string", default: "active,completed", example: "active,completed" } },
            { name: "check_domain", in: "query", description: "Require the requesting domain to match the licence's allowed domains", schema: { type: "boolean", default: true } },
            { name: "version", in: "query", schema: { type: "string" } },
            { name: "notes", in: "query", schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          responses: { 201: { description: "The file" }, 403: err, 413: err, 422: err, 501: err },
        },
      },
      "/licenses/{id}/files/{fileId}": {
        parameters: [idParam, { name: "fileId", in: "path", required: true, schema: { type: "string" } }],
        patch: {
          summary: "Update a file's release rule or metadata (permission: manage)",
          requestBody: body({ type: "object", properties: { statuses: { type: "array", items: { type: "string" } }, check_domain: { type: "boolean" }, version: { type: "string" }, notes: { type: "string" } } }),
          responses: { 200: { description: "The file" }, 403: err, 404: err, 422: err },
        },
        delete: { summary: "Delete a file (permission: manage)", responses: { 200: { description: "{ deleted: true, id }" }, 404: err } },
      },
      "/licenses/{id}/activations": {
        parameters: [idParam],
        get: { summary: "Sites (domains) registered for the licence", responses: { 200: { description: "{ max_sites, data: Activation[] }" }, 404: err } },
      },
      "/licenses/{id}/activations/{domain}": {
        parameters: [idParam, { name: "domain", in: "path", required: true, schema: { type: "string" } }],
        delete: { summary: "Release a site to free its slot (permission: manage)", responses: { 200: { description: "{ released: true, domain }" }, 403: err, 404: err } },
      },
      "/apps": {
        get: { summary: "List apps with their statistics", responses: { 200: { description: "{ data: App[] }" }, 401: err } },
        post: {
          summary: "Create an app (permission: manage)",
          requestBody: body({ $ref: "#/components/schemas/AppInput" }),
          responses: { 201: { description: "The app" }, 403: err, 409: err, 422: err },
        },
      },
      "/apps/{app}": {
        parameters: [appParam],
        get: { summary: "Get an app", responses: { 200: { description: "The app" }, 404: err } },
        patch: { summary: "Update an app (permission: manage)", requestBody: body({ $ref: "#/components/schemas/AppInput" }), responses: { 200: { description: "The app" }, 403: err, 404: err, 409: err, 422: err } },
        delete: { summary: "Delete an app and its files (permission: full). Refused while the app has licences", responses: { 200: { description: "{ deleted: true, id }" }, 403: err, 404: err, 409: err } },
      },
      "/apps/{app}/licenses": {
        parameters: [appParam],
        get: { summary: "List the licences of an app", description: "Same filters and paging as GET /licenses.", responses: { 200: { description: "{ data: License[], next }" }, 404: err } },
        post: { summary: "Issue a licence under the app (permission: manage)", description: "Same as POST /licenses with this app. The app's defaults apply to every field not sent.", requestBody: body({ $ref: "#/components/schemas/LicenseInput" }), responses: { 201: ok("Created"), 200: ok("Already existed (same external_ref)"), 403: err, 404: err, 422: err } },
      },
      "/apps/{app}/files": {
        parameters: [appParam],
        get: { summary: "List the files shared by the app", responses: { 200: { description: "{ data: File[] }" }, 404: err } },
        put: {
          summary: "Upload a file shared by every licence of the app (permission: manage)",
          description: "Same body and query parameters as PUT /licenses/{id}/files. Licences of the app see the file in their download list, subject to the file's release statuses.",
          parameters: [
            { name: "name", in: "query", required: true, schema: { type: "string" } },
            { name: "statuses", in: "query", schema: { type: "string", default: "active,completed" } },
            { name: "check_domain", in: "query", schema: { type: "boolean", default: true } },
            { name: "version", in: "query", schema: { type: "string" } },
            { name: "notes", in: "query", schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          responses: { 201: { description: "The file" }, 403: err, 413: err, 422: err, 501: err },
        },
      },
      "/apps/{app}/files/{fileId}": {
        parameters: [appParam, { name: "fileId", in: "path", required: true, schema: { type: "string" } }],
        patch: { summary: "Update a shared file's release rule or metadata (permission: manage)", requestBody: body({ type: "object", properties: { statuses: { type: "array", items: { type: "string" } }, check_domain: { type: "boolean" }, version: { type: "string" }, notes: { type: "string" } } }), responses: { 200: { description: "The file" }, 403: err, 404: err, 422: err } },
        delete: { summary: "Delete a shared file (permission: manage)", responses: { 200: { description: "{ deleted: true, id }" }, 404: err } },
      },
      "/licenses/{id}/activity": { parameters: [idParam], get: { summary: "Recent checks and changes", parameters: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 200, default: 50 } }], responses: { 200: { description: "{ data: Activity[] }" }, 404: err } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API key, wk_..." } },
      responses: { Error: { description: "Error", content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } } } } } },
      schemas: {
        LicenseInput: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 120 },
            customer_name: { type: "string", maxLength: 120 },
            customer_email: { type: "string", maxLength: 200 },
            app: { type: ["string", "null"], description: "App id or slug, or null for a standalone licence. On create, the app's defaults fill every field not sent" },
            max_sites: { type: ["integer", "null"], minimum: 1, description: "Maximum number of distinct sites (domains) that may use the licence. null for unlimited" },
            status: { enum: ["pending", "active", "completed", "suspended", "disabled"], default: "active" },
            expires_at: { type: ["string", "null"], description: "YYYY-MM-DD (end of that day, UTC), an ISO date-time, or null for no end date" },
            duration_days: { type: "integer", description: "On create or edit: end date = today + this many days (ignored when expires_at is sent)" },
            domains: { type: "array", items: { type: "string" } },
            message: { type: "string", maxLength: 300 },
            notes: { type: "string", maxLength: 4000 },
            external_ref: { type: "string", maxLength: 120, description: "Create only. Your own reference (order id), unique" },
          },
        },
        AppInput: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 80 },
            slug: { type: "string", description: "Lowercase letters, digits and hyphens, 2 to 48 characters. Generated from the name if omitted" },
            description: { type: "string", maxLength: 500 },
            default_status: { enum: ["pending", "active", "completed", "suspended", "disabled"], default: "active" },
            default_duration_days: { type: ["integer", "null"], description: "Days a new licence is valid. null for no expiry" },
            default_max_sites: { type: ["integer", "null"], description: "Maximum sites of a new licence. null for unlimited" },
            default_message: { type: "string", maxLength: 300 },
            notes: { type: "string", maxLength: 4000 },
          },
        },
        License: {
          type: "object",
          properties: {
            id: { type: "string" }, name: { type: "string" }, customer_name: { type: "string" }, customer_email: { type: "string" }, app: { type: ["object", "null"], properties: { id: { type: "string" }, slug: { type: "string" }, name: { type: "string" } } }, max_sites: { type: ["integer", "null"] }, sites_used: { type: "integer" }, key: { type: "string" }, check_url: { type: "string" },
            status: { type: "string", description: "Effective status: an active licence past its end date reads expired" },
            stored_status: { type: "string" }, valid: { type: "boolean", description: "true for active and completed" }, expires_at: { type: ["string", "null"] }, domains: { type: "array", items: { type: "string" } },
            message: { type: "string" }, notes: { type: "string" }, external_ref: { type: ["string", "null"] },
            created_at: { type: "string" }, updated_at: { type: "string" }, last_check_at: { type: ["string", "null"] }, last_check_domain: { type: ["string", "null"] }, check_count: { type: "integer" },
          },
        },
      },
    },
  }
}
