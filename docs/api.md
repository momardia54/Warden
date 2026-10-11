# API reference

Base URL: `https://<your-worker>/api/v1`. JSON in, JSON out. A machine-readable description is served at `/api/v1/openapi.json` (no key needed).

![API keys in the dashboard](screenshots/api.jpg)

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

## Errors

Every error is the HTTP status plus `{ "error": { "code": "...", "message": "..." } }`. Branch on `code`, which is stable; `message` is for people and can change.

| Status | Codes |
|---|---|
| `400` | `invalid_json` (the body is not a JSON object), `invalid_domain` |
| `401` | `unauthorized`: missing or unknown key |
| `403` | `forbidden`: the key's scope is too low |
| `404` | `<thing>_not_found`: `license_not_found`, `app_not_found`, `file_not_found`, `track_not_found`, `status_not_found`, `source_not_found`, `import_not_found`, `activation_not_found`, `ip_block_not_found`, `github_not_connected`; `not_found` for an unknown endpoint |
| `405` | `method_not_allowed` |
| `409` | A conflict with the current state: `slug_taken`, `app_not_empty`, `status_in_use`, `statuses_in_use`, `statuses_not_customized`, `already_customized`, `license_in_app`, `status_in_another_track`, `track_not_empty`, `already_blocked`, `cannot_retry` |
| `413` | `too_large`: body over 64 KB (`upload_failed` for a file over 100 MB) |
| `422` | `invalid_<field>` for the field at fault (`invalid_status`, `invalid_expires_at`, `invalid_cursor`, …), `upload_failed`, `invalid_file`, `invalid_track`, `invalid_source`, `invalid_settings` |
| `429` | `rate_limited`, with `Retry-After: 60` |
| `501`, `502` | `upload_failed` (no R2 bucket), `github_unavailable` |

## Lists and paging

Every list answers `{ "data": [...], "next": ... }`. When `next` is not `null`, request the following page with `?cursor=<next>`; `limit` sets the page size (1 to 100, default 50). Lists that are never long (statuses, tracks, GitHub repositories) are returned whole with `"next": null`. A `cursor` that is not the `next` of a previous page answers `422 invalid_cursor`.

```bash
curl "https://<worker>/api/v1/licenses?app=harbor-theme&limit=100" -H "Authorization: Bearer $WARDEN_KEY"
curl "https://<worker>/api/v1/licenses?app=harbor-theme&limit=100&cursor=lic_..." -H "Authorization: Bearer $WARDEN_KEY"
```

## The licence object

```json
{
  "id": "lic_0muu24ttwnkkef4q8mzlo",
  "name": "Harbor Studio website",
  "customer_name": "Harbor Studio",
  "customer_email": "billing@harborstudio.com",
  "app": { "id": "app_0muuchb5n8wy41fg81tnv", "slug": "harbor-theme", "name": "Harbor Theme" },
  "key": "WRD-D539Y-TY9NX-FFE9Z-NKSR6",
  "check_url": "https://warden.example.workers.dev/check/WRD-D539Y-TY9NX-FFE9Z-NKSR6",
  "status": "active",
  "stored_status": "active",
  "valid": true,
  "expires_at": "2027-10-04T16:50:49.988Z",
  "domains": [],
  "max_sites": 3,
  "sites_used": 1,
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

`status` is what a site is told: the stored status, or the status its expiry rule points to once the expiry date has passed (by default Active becomes Expired). `stored_status` is what is saved. `valid` is `true` when that status is valid (`grants_access`). `app` is `null` for a standalone licence. `max_sites` is `null` when the number of sites is unlimited; `sites_used` is the number of sites that have registered.

In every path below, `{id}` can be the licence id (`lic_...`) or the licence key (`WRD-...`).

## Endpoints

| Method and path | Scope | What it does |
|---|---|---|
| `GET /me` | read | The key's name and scope |
| `GET /stats` | read | `total`, `valid`, `invalid`, `expiring_within_14_days`, `not_checked_for_3_days` and `by_status` (a count per status key) |
| `GET /signing-key` | read | The installation's public signing key (below) |
| `GET /analytics` | read | Checks and downloads per day, totals, invalid checks by reason, top licences and files (`days`, `app`, `license`; see [analytics.md](analytics.md)) |
| `GET /ip-blocks` | read | Blocked IP addresses and ranges ([protection.md](protection.md)) |
| `POST /ip-blocks` | manage | Block an address or range (`ip`, `reason`, `expires_at`) |
| `DELETE /ip-blocks/{id}` | manage | Remove a block |
| `GET /protection` | read | Rate limits, blocking rules and allowlist ([protection.md](protection.md)) |
| `PATCH /protection` | full | Change protection settings (only what you send) |
| `GET /statuses` | read | The built-in default statuses ([statuses.md](statuses.md)) |
| `GET /licenses` | read | List, newest first |
| `POST /licenses` | manage | Create |
| `GET /licenses/{id}` | read | One licence |
| `PATCH /licenses/{id}` | manage | Change the fields you send |
| `DELETE /licenses/{id}` | full | Delete the licence and its history |
| `POST /licenses/{id}/status` | manage | Set the status |
| `POST /licenses/{id}/renew` | manage | Renew |
| `POST /licenses/{id}/regenerate-key` | full | New key; the old key and check URL stop working |
| `GET /licenses/{id}/activity` | read | Recent checks, downloads and changes |
| `GET /licenses/{id}/activations` | read | The sites (domains) registered for the licence |
| `DELETE /licenses/{id}/activations/{domain}` | manage | Release a site to free its slot |
| `GET /licenses/{id}/files` | read | The files attached to the licence |
| `PUT /licenses/{id}/files` | manage | Upload a file (raw body) |
| `PATCH /licenses/{id}/files/{fileId}` | manage | Change a file's release rule or metadata |
| `DELETE /licenses/{id}/files/{fileId}` | manage | Delete a file |
| `GET /apps` | read | List apps with their statistics |
| `POST /apps` | manage | Create an app |
| `GET /apps/{app}` | read | One app |
| `PATCH /apps/{app}` | manage | Change an app |
| `DELETE /apps/{app}` | full | Delete an app (only when it has no licences) |
| `GET /apps/{app}/licenses` | read | The licences of an app |
| `POST /apps/{app}/licenses` | manage | Issue a licence under the app, with its defaults |
| `GET /apps/{app}/files` | read | The files shared by the app |
| `GET /apps/{app}/versions` | read | The versions the app's sites run, and how many are outdated |
| `PUT /apps/{app}/files` | manage | Upload a shared file (raw body) |
| `PATCH /apps/{app}/files/{fileId}` | manage | Change a shared file's release rule or metadata |
| `DELETE /apps/{app}/files/{fileId}` | manage | Delete a shared file |

In the `/apps/{app}` paths, `{app}` is the app id (`app_...`) or its slug.

### List

`GET /licenses?status=active&app=harbor-theme&q=harbor&external_ref=order-1042&limit=50&cursor=<next>`

Returns `{ "data": [licence, ...], "next": "lic_..." | null }`, newest first. `status` is a status key (matched on the status reported to sites, so an expiry rule that has triggered counts). `app` limits the list to one app (id or slug). `q` searches name, customer, key, domains, `external_ref` and the app name. Paging as described in [Lists and paging](#lists-and-paging); `before` is the earlier name of `cursor`, accepted until 1.0.0.

### Create

`POST /licenses`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required, up to 120 characters |
| `app` | string or null | App id or slug. The app's defaults fill every field below that you leave out. `null` or omitted: standalone licence |
| `customer_name` | string | Optional, up to 120 characters |
| `customer_email` | string | Optional, a valid email address |
| `max_sites` | integer or null | Maximum number of distinct sites (domains) that may use the licence. `null`: unlimited |
| `status` | string | A status key of the statuses that apply to the licence. Default: the default status of that set (the app's default status when issued under an app) |
| `expires_at` | string or null | `YYYY-MM-DD` (end of that day, UTC) or an ISO date-time. `null` or omitted: no expiry date |
| `duration_days` | integer | Alternative to `expires_at`: ends this many days from now (1 to 3650) |
| `domains` | array of strings | Allowed domains; subdomains match. Empty: any |
| `message` | string | Public message returned to the site in the check response (up to 300 characters) |
| `notes` | string | Internal, never returned to a site (up to 4000 characters) |
| `external_ref` | string | Your own reference, for example an order id. Unique |

Returns `201` and the licence. **Idempotent:** if a licence with the same `external_ref` already exists, nothing is created and that licence comes back with `200` and the header `Idempotent-Replayed: true`. Retrying a request or receiving the same payment webhook twice is therefore safe.

```bash
curl -X POST https://<worker>/api/v1/licenses \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Harbor Studio website","app":"harbor-theme","customer_name":"Harbor Studio","customer_email":"billing@harborstudio.com","external_ref":"order-1042"}'
```

With an `app`, the duration, status, site limit and public message come from the app's defaults, so this request issues a one-year licence for as many sites as the app allows. Any field you send overrides the default (`"duration_days": 30`, `"max_sites": 5`, `"expires_at": null`).

### Edit

`PATCH /licenses/{id}` takes the same fields (except `external_ref`) and changes only those you send. `{"expires_at": null}` removes the expiry date. `{"app": "other-app"}` moves the licence to another app and `{"app": null}` makes it standalone; the licence then sees the files of its new app.

### Status

`POST /licenses/{id}/status` with `{"status": "suspended"}`. The value is a status key of the statuses that apply to the licence ([statuses.md](statuses.md)); any status of the set can be set. An unknown key returns `422` with the valid keys.

### Renew

`POST /licenses/{id}/renew` with either

- `{"days": 30}`: moves the expiry date forward by 30 days, counted from the current expiry date, or from today when that date has passed or the licence has no expiry date (which then gives it one)
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
| `version` | Optional. Makes the file a release offered as an update: numbers separated by dots, optional suffix (`1.4.0`, `2.0.0-beta.1`). An invalid version returns `422` |
| `channel` | `stable` (default) or `beta` |
| `changelog` | Public release notes (up to 10,000 characters). Can also be set later with `PATCH` |
| `notes` | Internal notes, never sent to sites |

```bash
curl -X PUT "https://<worker>/api/v1/licenses/<id or key>/files?name=harbor-theme.zip&statuses=completed&check_domain=false&version=2.0.0" \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/zip" --data-binary @harbor-theme.zip
```

Returns `201` and the file:

```json
{ "id": "fil_...", "name": "harbor-theme.zip", "version": "2.0.0", "channel": "stable", "changelog": "", "notes": "", "size": 800000,
  "content_type": "application/zip", "sha256": "4c2a...", "signature": "base64...", "withdrawn": false, "withdrawn_at": null,
  "statuses": ["completed"], "check_domain": false, "available": false,
  "uploaded_at": "...", "download_count": 0, "last_download_at": null, "download_url": "https://<worker>/download/WRD-.../fil_..." }
```

`available` says whether the file can be downloaded right now, ignoring the domain check. `sha256` is computed during the upload (`null` for files uploaded before checksums were introduced). `signature` is the Ed25519 signature of `sha256` ([releases.md](releases.md#verifying-a-package)), `null` when there is no checksum.

| Request | Permission | Description |
|---|---|---|
| `GET /licenses/{id}/files` | read | `{ "data": [file, ...], "next" }`, newest first |
| `PATCH /licenses/{id}/files/{fileId}` | manage | Change `statuses`, `check_domain`, `version`, `channel`, `changelog` or `notes`, or set `withdrawn` (`true` withdraws a release, `false` restores it). JSON body, only the fields sent |
| `DELETE /licenses/{id}/files/{fileId}` | manage | Remove the file from storage |

Uploading returns `501` when the deployment has no R2 bucket. Releases, channels and update offers are described in [releases.md](releases.md).

### Statuses

The statuses are configurable at app level and licence level: see [statuses.md](statuses.md) for the model and the endpoints (`/apps/{app}/statuses`, `/licenses/{id}/statuses`; `/statuses` returns the built-in defaults).

### Sites (activations)

A site registers when it checks the licence with its domain (`?domain=`). When the licence has a `max_sites` limit, checks from further sites are invalid (`site_limit_reached`) once it is reached.

`GET /licenses/{id}/activations` returns `{ "max_sites": 3, "data": [ { "domain", "version", "first_seen_at", "last_seen_at", "check_count", "last_ip" } ], "next" }`. `version` is the version the site last reported with its check (`?version=`), or `null`. `DELETE /licenses/{id}/activations/{domain}` releases a site; it can register again on its next check if the licence has room. See [apps.md](apps.md#sites-and-the-site-limit).

### Apps

An app is a product you license to many customers. See [apps.md](apps.md) for the concepts.

```json
{
  "id": "app_0muuchb5n8wy41fg81tnv",
  "name": "Harbor Theme",
  "slug": "harbor-theme",
  "description": "Premium WordPress theme for studios",
  "default_status": "active",
  "default_duration_days": 365,
  "default_max_sites": 2,
  "default_message": "Thank you for your purchase",
  "notes": "",
  "licenses": 3,
  "licenses_valid": 3,
  "sites": 2,
  "files": 3,
  "latest_version": "2.0.0",
  "created_at": "...",
  "updated_at": "..."
}
```

`POST /apps` and `PATCH /apps/{app}` take these fields: `name` (required on create), `slug` (generated from the name if omitted: lowercase letters, digits and single hyphens, 2 to 48 characters, unique), `description`, `default_status`, `default_duration_days` (1 to 3650, or `null` for no expiry), `default_max_sites` (1 or more, or `null` for unlimited), `default_message` and `notes`. A duplicate slug returns `409`.

`DELETE /apps/{app}` needs the `full` permission and returns `409` (`app_not_empty`) while the app still has licences. It deletes the app's files.

`licenses_valid` counts licences for which a check currently returns `valid: true`. `latest_version` is the highest stable version among the app's current releases (withdrawn releases excluded).

`GET /apps/{app}/versions` returns `{ "latest_version", "sites", "outdated", "data": [ { "version", "sites", "outdated" } ] }`: how many sites run each reported version, newest first (`version` is `null` for sites that never reported one).

`PUT /apps/{app}/files` uploads a file that every licence of the app can see, with the same body, query parameters and release rule as a licence file (below). The file JSON of an app has no `available` or `download_url`, because the download URL contains a licence key; licences get the URL from `GET /download/<key>` ([files.md](files.md)).

### Release tracks

A track is what a set of licence statuses receives ([releases.md](releases.md#tracks)). Each status belongs to one track of an app or licence at most. Endpoints under `/apps/{app}/tracks` and `/licenses/{id}/tracks`; `{track}` is a track's id or name.

| Method and path | Scope | Description |
|---|---|---|
| `GET .../tracks` | read | `{ data: [{ id, name, statuses, check_domain, position, releases, source }], next: null, conflicts }`. For a licence, also `app_tracks` and `receives`: `{ status, track, name, inherited }`, the track that serves its current status |
| `POST .../tracks` | manage | Create: `{ "name": "Final build", "statuses": ["completed"], "check_domain": true }`. `409 status_in_another_track` when a status is already served |
| `GET .../tracks/{track}` | read | One track |
| `PATCH .../tracks/{track}` | manage | Change `name`, `statuses`, `check_domain`, `position`. The statuses and domain check apply to all its releases |
| `DELETE .../tracks/{track}?move_to={track}` | full | Delete; its releases move to `move_to` (required while it has releases) and its repository is disconnected |

Uploads (`PUT .../files`) take `track` (id or name) for a release. Without it: the only track, or a new track *Releases* when there is none; with several tracks, `track` is required. `statuses` on a release upload picks the track with exactly those statuses, or creates one. `PATCH .../files/{fileId}` takes `track` to move a release; `statuses` and `check_domain` apply to attachments only. Files return `track` (null for an attachment).

### Release source

A track can be fed by a GitHub repository, through the install's GitHub App or with an access token and a webhook of its own. Endpoints under `.../tracks/{track}/source`:

| Method and path | Scope | Description |
|---|---|---|
| `GET .../source` | read | The connected repository; `webhook_secret` only for `manage` and `full` keys, the access token never (`has_token`) |
| `PUT .../source` | manage | Connect or edit: `connection` (`app` or `token`), `provider`, `repository`, `trigger`, `tag_prefix`, `package_folder`, `token`, `enabled` (201 when connected, 200 when edited). A new source uses `app` when the GitHub App is connected and no token is sent |
| `DELETE .../source` | manage | Disconnect; published releases stay |
| `POST .../source/regenerate-secret` | manage | Replace the webhook secret |
| `GET .../source/imports` | read | Tags, newest first, paged: `{ id, tag, version, commit, state, detail, file_id, started_at, finished_at }`, `state` is `pending`, `imported`, `skipped` or `failed` |
| `POST .../source/imports` | manage | Publish an existing tag: `{ "tag": "v1.4.0" }` (202; runs in the background) |
| `POST .../source/imports/{id}/retry` | manage | Retry a failed or skipped tag |

The GitHub App (created in the dashboard under Integrations):

| Method and path | Scope | Description |
|---|---|---|
| `GET /integrations/github` | read | `{ connected, app, installations }`, without the app's key or secrets |
| `GET /integrations/github/repositories` | read | `{ data: [{ id, full_name, private, account }], next: null }`: the repositories the app can access |

Details, including the webhook setup: [repositories.md](repositories.md).

### Activity

`GET /licenses/{id}/activity?limit=50` returns `{ "data": [ { "at", "event": "check" | "change" | "download", "status", "domain", "ip", "detail" } ], "next" }`, newest first, paged with `cursor`. `ip` is the caller of a check or a download (null for changes, and after 90 days). Sites (`/activations`) include `last_ip`.

### Signing key

`GET /signing-key` returns the installation's public Ed25519 key, which signs check and download responses and releases ([checking.md](checking.md#verifying-the-signature)):

```json
{ "algorithm": "Ed25519", "key_id": "3f9c0a7d51e2b846", "public_key": "base64 of the 32-byte key", "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----", "created_at": "2026-10-11T09:00:00.000Z" }
```

Put `public_key` (libsodium, PHP) or `public_key_pem` (OpenSSL, Node.js) in the site's code. The private key is never returned.

### Rate limit

Each API key is rate limited (600 requests per minute by default, set under Protection). Over the limit the API answers `429` with `Retry-After: 60` and the code `rate_limited`.

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
