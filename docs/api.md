# API reference

Base URL: `https://<your-worker>/api/v1`. JSON in, JSON out. A machine-readable description is served at `/api/v1/openapi.json` (no key needed).

## Authentication

Create a key in the dashboard (**API** page). The key is shown once. Send it on every request:

```
Authorization: Bearer wk_...        (or the header X-API-Key: wk_...)
```

A key acts as your account. Scopes:

| Scope | Allows |
|---|---|
| `read` | `GET` everything |
| `manage` | also create, edit, set status, renew |
| `full` | also delete a licence and regenerate its key |

Errors: HTTP status plus `{ "error": { "code": "...", "message": "..." } }`. `401` bad or missing key, `403` the scope is too low, `404` not found, `422` invalid input, `413` body over 64 KB.

## The licence object

```json
{
  "id": "lic_0muu24ttwnkkef4q8mzlo",
  "name": "Harbor Studio website",
  "client": "Harbor Studio",
  "key": "WRD-D539Y-TY9NX-FFE9Z-NKSR6",
  "check_url": "https://warden.example.workers.dev/check/WRD-D539Y-TY9NX-FFE9Z-NKSR6",
  "status": "active",
  "stored_status": "active",
  "valid": true,
  "expires_at": "2027-10-04T16:50:49.988Z",
  "domains": ["harborstudio.com"],
  "message": "",
  "notes": "",
  "external_ref": "order-1042",
  "created_at": "2026-10-04T16:50:49.988Z",
  "updated_at": "2026-10-04T16:50:49.988Z",
  "last_check_at": null,
  "last_check_domain": null,
  "check_count": 0
}
```

`status` is what a site is told: an active licence past its expiry date reads `expired`. `stored_status` is what is saved. `valid` is `true` for `active` and `completed`.

In every path below, `{id}` can be the licence id (`lic_...`) or the licence key (`WRD-...`).

## Endpoints

| Method and path | Scope | What it does |
|---|---|---|
| `GET /me` | read | The key's name and scope |
| `GET /stats` | read | Totals and counts per status, licences ending within 14 days, active licences not checked for 3 days |
| `GET /licenses` | read | List, newest first |
| `POST /licenses` | manage | Create |
| `GET /licenses/{id}` | read | One licence |
| `PATCH /licenses/{id}` | manage | Change the fields you send |
| `DELETE /licenses/{id}` | full | Delete the licence and its history |
| `POST /licenses/{id}/status` | manage | Set the status |
| `POST /licenses/{id}/renew` | manage | Renew |
| `POST /licenses/{id}/regenerate-key` | full | New key; the old key and check URL stop working |
| `GET /licenses/{id}/activity` | read | Recent checks, downloads and changes |
| `GET /licenses/{id}/files` | read | The files attached to the licence |
| `PUT /licenses/{id}/files` | manage | Upload a file (raw body) |
| `PATCH /licenses/{id}/files/{fileId}` | manage | Change a file's release rule or metadata |
| `DELETE /licenses/{id}/files/{fileId}` | manage | Delete a file |

### List

`GET /licenses?status=active&q=harbor&external_ref=order-1042&limit=25&before=<next>`

Returns `{ "data": [licence, ...], "next": "lic_..." | null }`. `status` is one of `pending`, `active`, `suspended`, `disabled`, `expired` (matched on the effective status). `q` searches name, client, key, domains and `external_ref`. Pass `next` as `before` to get the following page. `limit` is 1 to 100.

### Create

`POST /licenses`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required, up to 120 characters |
| `client` | string | Optional |
| `status` | string | `pending`, `active` (default), `completed`, `suspended`, `disabled` |
| `expires_at` | string or null | `YYYY-MM-DD` (end of that day, UTC) or an ISO date-time. `null` or omitted: no expiry date |
| `duration_days` | integer | Alternative to `expires_at`: ends this many days from now (1 to 3650) |
| `domains` | array of strings | Allowed domains; subdomains match. Empty: any |
| `message` | string | Shown to the site when the licence is not active (up to 300 characters) |
| `notes` | string | Private, never sent to a site (up to 4000 characters) |
| `external_ref` | string | Your own reference, for example an order id. Unique |

Returns `201` and the licence. **Idempotent:** if a licence with the same `external_ref` already exists, nothing is created and that licence comes back with `200` and the header `Idempotent-Replayed: true`. Retrying a request or receiving the same payment webhook twice is therefore safe.

```bash
curl -X POST https://<worker>/api/v1/licenses \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Harbor Studio website","client":"Harbor Studio","domains":["harborstudio.com"],"duration_days":365,"external_ref":"order-1042"}'
```

### Edit

`PATCH /licenses/{id}` takes the same fields (except `external_ref`) and changes only those you send. `{"expires_at": null}` removes the expiry date.

### Status

`POST /licenses/{id}/status` with `{"status": "suspended"}`. Allowed: `pending`, `active`, `completed`, `suspended`, `disabled`. `completed` means paid in full: valid, permanent (the expiry date is ignored) and files released in Completed become available. (`expired` is never set by hand; it follows from the expiry date.)

### Renew

`POST /licenses/{id}/renew` with either

- `{"days": 30}`: moves the expiry date forward by 30 days, counted from the current expiry date, or from today when that date has passed
- `{"until": "2027-06-30"}`: sets the expiry date (must be in the future)

A licence that had expired becomes active again. A `suspended` or `disabled` licence keeps its status; renewing does not lift a suspension, call the status endpoint for that.

### Files

A file is downloadable while the licence status is one of the file's `statuses`. See [files.md](files.md) for the rules and examples.

`PUT /licenses/{id}/files` uploads a file. The **request body is the raw file** (not multipart), up to 100 MB, and the request needs a `Content-Length` header (curl and fetch send one for a file body).

| Query parameter | Notes |
|---|---|
| `name` | Required. The download file name (folders and reserved characters are stripped) |
| `statuses` | Comma separated licence statuses in which the file is available. Default `active,completed` |
| `check_domain` | `true` (default) or `false`. Require a matching `?domain=` when the licence lists domains |
| `version`, `notes` | Optional text |

```bash
curl -X PUT "https://<worker>/api/v1/licenses/<id or key>/files?name=harbor-theme.zip&statuses=completed&check_domain=false&version=2.0.0" \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/zip" --data-binary @harbor-theme.zip
```

Returns `201` and the file:

```json
{ "id": "fil_...", "name": "harbor-theme.zip", "version": "2.0.0", "notes": "", "size": 800000, "content_type": "application/zip",
  "statuses": ["completed"], "check_domain": false, "available": false,
  "uploaded_at": "...", "download_count": 0, "last_download_at": null, "download_url": "https://<worker>/download/WRD-.../fil_..." }
```

`available` says whether the file can be downloaded right now, ignoring the domain check.

| Request | Permission | Description |
|---|---|---|
| `GET /licenses/{id}/files` | read | `{ "data": [file, ...] }` |
| `PATCH /licenses/{id}/files/{fileId}` | manage | Change `statuses`, `check_domain`, `version` or `notes` (JSON body, only the fields sent) |
| `DELETE /licenses/{id}/files/{fileId}` | manage | Remove the file from storage |

Uploading returns `501` when the deployment has no R2 bucket.

### Activity

`GET /licenses/{id}/activity?limit=50` returns `{ "data": [ { "at", "event": "check" | "change" | "download", "status", "domain", "detail" } ] }`, newest first.

## Examples

Pay, then renew and re-activate, from a payment webhook:

```bash
curl -X POST https://<worker>/api/v1/licenses/WRD-D539Y-TY9NX-FFE9Z-NKSR6/renew \
  -H "Authorization: Bearer $WARDEN_KEY" -d '{"days":30}'
curl -X POST https://<worker>/api/v1/licenses/WRD-D539Y-TY9NX-FFE9Z-NKSR6/status \
  -H "Authorization: Bearer $WARDEN_KEY" -d '{"status":"active"}'
```

Everything that needs attention:

```bash
curl -H "Authorization: Bearer $WARDEN_KEY" "https://<worker>/api/v1/licenses?status=expired"
curl -H "Authorization: Bearer $WARDEN_KEY" "https://<worker>/api/v1/stats"
```
