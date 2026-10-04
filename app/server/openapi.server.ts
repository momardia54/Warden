/** OpenAPI 3.1 description of the API, served at /api/v1/openapi.json. */
export function openApiSpec(origin: string) {
  const idParam = { name: "id", in: "path", required: true, description: "Licence id (lic_...) or the licence key (WRD-...).", schema: { type: "string" } }
  const ok = (description: string, ref = "License") => ({ description, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } })
  const err = { $ref: "#/components/responses/Error" }
  const body = (schema: object) => ({ required: true, content: { "application/json": { schema } } })
  const secured = [{ bearer: [] }]

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
            { name: "status", in: "query", schema: { enum: ["pending", "active", "suspended", "disabled", "expired"] } },
            { name: "q", in: "query", description: "Search name, client, key, domains, external_ref", schema: { type: "string" } },
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
        post: { summary: "Set the status", requestBody: body({ type: "object", required: ["status"], properties: { status: { enum: ["pending", "active", "suspended", "disabled"] } } }), responses: { 200: ok("Updated"), 403: err, 404: err, 422: err } },
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
            client: { type: "string", maxLength: 120 },
            status: { enum: ["pending", "active", "suspended", "disabled"], default: "active" },
            expires_at: { type: ["string", "null"], description: "YYYY-MM-DD (end of that day, UTC), an ISO date-time, or null for no end date" },
            duration_days: { type: "integer", description: "On create or edit: end date = today + this many days (ignored when expires_at is sent)" },
            domains: { type: "array", items: { type: "string" } },
            message: { type: "string", maxLength: 300 },
            notes: { type: "string", maxLength: 4000 },
            external_ref: { type: "string", maxLength: 120, description: "Create only. Your own reference (order id), unique" },
          },
        },
        License: {
          type: "object",
          properties: {
            id: { type: "string" }, name: { type: "string" }, client: { type: "string" }, key: { type: "string" }, check_url: { type: "string" },
            status: { type: "string", description: "Effective status: an active licence past its end date reads expired" },
            stored_status: { type: "string" }, valid: { type: "boolean" }, expires_at: { type: ["string", "null"] }, domains: { type: "array", items: { type: "string" } },
            message: { type: "string" }, notes: { type: "string" }, external_ref: { type: ["string", "null"] },
            created_at: { type: "string" }, updated_at: { type: "string" }, last_check_at: { type: ["string", "null"] }, last_check_domain: { type: ["string", "null"] }, check_count: { type: "integer" },
          },
        },
      },
    },
  }
}
