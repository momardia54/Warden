# Warden

**A self-hosted licence manager for Cloudflare Workers.** License a product to many customers (an **app**) or a single project (a **standalone licence**). Every licence has a licence key and a check URL, and its status can be changed from a dashboard or from your own code through an API.

> **Status: pre-1.0 (0.1.x).** It works and is tested, but the API and data model may still change before 1.0.0. See [Roadmap.md](Roadmap.md) and [Security.md](Security.md).

![Warden overview](docs/screenshots/overview.jpg)

## How it works

1. You issue a licence in Warden, from the dashboard or the API, for a standalone project or under an app. Warden gives it a **licence key** and a **check URL**.
2. The customer's site calls the check URL with its domain (for example every 12 hours) and reads the response: `valid`, `status`, `message`.
3. You change the licence status in the dashboard, or by API. The next time the site checks, it sees the new status and acts on it.

Warden **creates and manages** licences. **Enforcement lives in the site's code**, so you decide what an invalid licence does: show a notice, switch a feature off, show a maintenance page. [docs/checking.md](docs/checking.md) has PHP and JavaScript examples, including how to verify the signed response.

## Features

- **Apps**: a product sold to many customers, with defaults for new licences (status, duration, maximum sites, message), its own licence list and releases shared by all of its licences ([docs/apps.md](docs/apps.md))
- **Site limit**: a licence can be limited to N sites; sites register on their first check and you can release them
- Licence key (`WRD-XXXXX-XXXXX-XXXXX-XXXXX`) and a ready-to-use check URL per licence, with a customer name and email
- Statuses: **pending, active, completed, suspended, disabled, expired**. An active licence past its expiry date reports `expired` by itself. **Completed** means paid in full: valid and permanent
- Optional expiry date, optional allowed domains (subdomains match), a public message returned to the site, internal notes
- **Signed responses** (`X-Warden-Signature`, HMAC-SHA256 keyed with the licence key)
- Activity log per licence: every check (which domain, which result) and every change
- Overview: active count, licences expiring soon, active licences whose site stopped checking in
- **Files per licence** (stored in R2), each with a release rule: the licence statuses in which it can be downloaded. Use it to ship updates while a licence is in effect, to release a final build when the client has paid in full, or to serve a notice while a licence is suspended ([docs/files.md](docs/files.md))
- **Extend expiry** in one click (+30 days, +90 days, +1 year) and **regenerate key**
- **API** with scoped keys, idempotent create, renew, status, search and paging, plus an OpenAPI description
- Single admin login from Worker secrets, no third-party services, runs on the Workers and D1 free plans

| | |
|---|---|
| ![Apps](docs/screenshots/apps.jpg) | ![App page](docs/screenshots/app.jpg) |
| Apps with licence counts, sites and latest version | An app: releases shared by its licences, and its licences |
| ![Licences](docs/screenshots/licences.jpg) | ![Licence page](docs/screenshots/licence.jpg) |
| Licences of all apps, with app and status filters | Licence key, check URL and details |
| ![Sites and files](docs/screenshots/sites-and-files.jpg) | ![Edit a file's release rule](docs/screenshots/edit-file.jpg) |
| Registered sites, and the files a licence can download | Changing the statuses a file is available in |
| ![New licence under an app](docs/screenshots/new-licence.jpg) | ![New app](docs/screenshots/new-app.jpg) |
| Issuing a licence with the app's defaults | Creating an app |

## The check URL

```
GET https://<your-worker>/check/<licence key>?domain=client-site.org
```

```json
{ "name": "Harbor Studio website", "valid": true, "status": "active", "message": "", "expires_at": "2027-03-31T23:59:59.999Z", "checked_at": "2026-10-04T16:17:30.248Z" }
```

`valid` is `true` only when the status is `active`, the expiry date has not passed, and the domain matches (if the licence lists domains). Other `status` values: `pending`, `suspended`, `disabled`, `expired`, `domain_mismatch`, `unknown` (HTTP 404). Full details and verification code: [docs/checking.md](docs/checking.md).

Recommended in the site: check about every 12 hours, act only on a response you could read and verify, and **keep the last known state on network errors or 5xx**, so a Warden outage never locks a client out.

## Files

Attach files to a licence in the dashboard or by API. Each file has a **release rule**: the licence statuses in which it can be downloaded, and whether the site's domain must match.

| Example | Statuses | Domain check |
|---|---|---|
| Updates for a licensed site | active, completed | on |
| Final release after full payment | completed | off |
| Maintenance or renewal notice | suspended | off |

```
GET https://<your-worker>/download/<licence key>                         # status and files, with availability
GET https://<your-worker>/download/<licence key>/<file id>?domain=site   # the file, or a JSON refusal (HTTP 403)
```

When the last payment of a project arrives, set the licence to **Completed**: it stays valid permanently and a file released in Completed becomes available. Every download and refusal is logged. Details and examples: [docs/files.md](docs/files.md).

## The API

Create a key on the **API** page of the dashboard and send it as `Authorization: Bearer wk_...`.

```bash
# create a licence (safe to retry: the same external_ref returns the first one)
curl -X POST https://<worker>/api/v1/licenses \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Harbor Studio website","domains":["harborstudio.com"],"duration_days":365,"external_ref":"order-1042"}'

# renew by 30 days, suspend, list what has expired
curl -X POST   https://<worker>/api/v1/licenses/<id or key>/renew  -H "Authorization: Bearer $WARDEN_KEY" -d '{"days":30}'
curl -X POST   https://<worker>/api/v1/licenses/<id or key>/status -H "Authorization: Bearer $WARDEN_KEY" -d '{"status":"suspended"}'
curl           "https://<worker>/api/v1/licenses?status=expired"   -H "Authorization: Bearer $WARDEN_KEY"
```

| Scope | Allows |
|---|---|
| `read` | list, read, stats, activity |
| `manage` | also create, edit, set status, renew |
| `full` | also delete and regenerate keys |

Endpoints: `GET /me`, `GET /stats`, `GET|POST /licenses`, `GET|PATCH|DELETE /licenses/{id}`, `POST /licenses/{id}/status`, `/renew`, `/regenerate-key`, `GET /licenses/{id}/activity`, `GET /licenses/{id}/activations`, `DELETE /licenses/{id}/activations/{domain}`, `GET|PUT /licenses/{id}/files`, `PATCH|DELETE /licenses/{id}/files/{fileId}`, `GET|POST /apps`, `GET|PATCH|DELETE /apps/{app}`, `GET|POST /apps/{app}/licenses`, `GET|PUT /apps/{app}/files`, `PATCH|DELETE /apps/{app}/files/{fileId}`. Reference: [docs/api.md](docs/api.md), or `/api/v1/openapi.json` on your own install.

## Run and deploy

Requirements: Node 22 and a Cloudflare account.

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH     # if your default Node is newer than 22
npm install
printf 'ADMIN_USERNAME="admin"\nADMIN_PASSWORD="a-long-password"\n' > .dev.vars
npm run dev          # http://localhost:5173 (local D1 database, migrations applied for you)
npm test             # unit and API tests
```

Deploy to your own account:

```bash
npm run deploy       # builds, creates the D1 database "<worker-name>-db", the R2 bucket for files and a daily Cron Trigger, deploys the Worker
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET     # optional but recommended: openssl rand -hex 32
```

The database tables are created and upgraded by the Worker itself on the first request, so there is no migration step. Until the two admin secrets exist, the login page tells you what to add.

R2 has to be activated once in the Cloudflare dashboard (it asks for a payment method, even for the free tier). Without it, everything works except the Files section, which says so.

Use a custom domain (Workers > your Worker > Settings > Domains) so check URLs do not depend on `workers.dev`.

## Under the hood

React Router 7 (SSR) on Cloudflare Workers, Cloudflare D1 (data) and R2 (files), Tailwind and shadcn/ui, TypeScript. One daily Cron Trigger deletes check history older than 90 days. The public check endpoint and the API are served by the Worker before the dashboard, and do not use cookies.

```
workers/app.ts              entry: migrations, /api/v1, /check/<key>, dashboard
app/server/check.server.ts  the check endpoint and its signature
app/server/download.server.ts  gated file downloads
app/server/files.server.ts  file storage in R2
app/server/api.server.ts    API: keys, routes, validation
app/server/licenses.server.ts   licence logic shared by dashboard and API
app/lib/license.ts          statuses, key format, domain rules, the response
migrations/                 D1 schema
tests/                      node:test, runs the real SQL on a SQLite stand-in for D1
```

## Project files

- [Roadmap.md](Roadmap.md): what is done and what comes before 1.0.0
- [Security.md](Security.md): how it is protected, its limits, how to report a problem
- [CHANGELOG.md](CHANGELOG.md): what changed
- [Licence.md](Licence.md): MIT

The dashboard UI kit (shadcn/ui components, sidebar and layout) is derived from [FormZero](https://github.com/BohdanPetryshyn/formzero) by Bohdan Petryshyn (MIT), and both copyright holders are named in the licence.
