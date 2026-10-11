# Upgrade notes

What to change on your side when you move to a new version: in site code that checks licences, in code that calls the API, and in bookmarks. Each section lists only the changes that need action; everything else is in [CHANGELOG.md](../CHANGELOG.md).

Upgrade one version at a time in this list, or apply every section between your version and the new one. Your version is shown in the dashboard's account menu and in `/api/v1/openapi.json`.

## Before you upgrade

Export the database:

```bash
npx wrangler d1 export <worker-name>-db --remote --output warden-backup.sql
```

The export contains everything Warden stores, including the private signing key (from 0.3.0) and the GitHub App's key: keep it as private as the dashboard password. D1's Time Travel can also restore the database to any minute of the last 7 days (30 on the paid plan).

Database migrations run by themselves on the first request after the update, and only move forward: to go back to an earlier version, restore the export.

## 0.3 to 0.4

Migration 0014 runs on the first request: it adds grace periods and webhooks. Nothing breaks; there is nothing to change unless you use the features below.

- **Cron Trigger.** It now runs every 10 minutes (`*/10 * * * *` in `wrangler.jsonc`) instead of once a day. A deploy updates it. It is still a single trigger, so it does not count against Cloudflare's per-account limit more than before.
- **Check response.** It has a new field, `grace_ends_at` (`null` unless the licence is in its grace period). While a licence is in its grace period, `valid` is `true` and `message` holds a reminder when the licence has no public message. Site code that shows `message` when it is not empty will show that reminder: decide whether that is what you want.
- **Licences and apps in the API** have new fields: `grace_days` (both), `effective_grace_days` and `grace_ends_at` (licences).
- **Renewals during a grace period** extend from the expiry date, not from the day of the renewal.

## 0.2 to 0.3

No database migration. The signing key is created on the first check, download or dashboard visit after the update.

**Site code (check and download).** Nothing breaks: existing site code keeps working until 1.0.0. Plan the move now:

- Responses are signed with the installation's **Ed25519 key** (`X-Warden-Signature-Ed25519`, `X-Warden-Key-Id`). Copy the public key from a licence page (*Integration* tab) or `GET /api/v1/signing-key`, and verify with it as shown in [checking.md](checking.md#verifying-the-signature). Ship this to every site before 1.0.0.
- `X-Warden-Signature` (HMAC keyed with the licence key) is **deprecated** and removed in 1.0.0.
- Send a `nonce` with each check and compare it, and `license_key`, with the response, to reject replayed answers.
- Releases carry `signature`; the downloaded file carries `X-Warden-Release-Signature`. Verify the package before installing it ([releases.md](releases.md#verifying-a-package)).
- The check response has three new fields, `license_key`, `domain` and `nonce`; the download list has `license_key` and `checked_at`. Code that reads fields by name is not affected.

**API.**

| Before (0.2) | Now (0.3) | What to do |
|---|---|---|
| `GET /stats` returned `in_force` and `not_in_force` | Removed | Read `valid` and `invalid` |
| Apps returned `licenses_in_force` | Removed | Read `licenses_valid` |
| `GET /licenses`: 25 per page by default, `before` to continue | 50 per page by default, `cursor` to continue | Pass `next` as `cursor`. `before` still works until 1.0.0 |
| Apps, files, activations, IP blocks and repository imports were returned whole | Paged: `{ data, next }`, 50 per page by default, at most 100 | Follow `next` with `cursor` until it is `null` |
| `GET /licenses/{id}/activity` took `limit` up to 200 | Up to 100, paged with `cursor` | Follow `next` |
| `GET /analytics` with an unknown licence or app: code `not_found` | `license_not_found` or `app_not_found` | Update error handling that matched `not_found` |
| `DELETE /ip-blocks/{id}` for an unknown block: code `not_found` | `ip_block_not_found` | Same |
| An unsupported method on `/protection` or `/ip-blocks` answered 404 | 405 `method_not_allowed` | None, unless you relied on the 404 |

Lists that are never long (statuses, tracks, GitHub repositories) are returned whole, with `next: null`.

**Dashboard.** The licence list addresses `?view=in_force` and `?view=not_in_force` no longer work: update bookmarks to `?view=valid` and `?view=invalid`. New denied downloads are logged as "Download denied" (earlier entries keep "Download refused"); Analytics counts both.

## 0.1 to 0.2

Migrations 0007 to 0013 run on the first request. Existing releases are put into release tracks (one per distinct release rule), so no licence gains or loses access.

**Site code.**

- Versions are compared by semantic versioning precedence: `2.0.0-rc.1` now ranks below `2.0.0`. Sites on a pre-release are offered the final release.
- The download list no longer includes a file's internal `notes`.
- Checks and downloads can receive `403` (`status: blocked`, the caller's IP address is blocked) or `429` (rate limited, no `valid` field, `Retry-After: 60`). Keep the last known state on both ([checking.md](checking.md)).

**API.**

- `GET /stats` returns `valid` and `invalid`; apps return `licenses_valid`. The earlier names were kept as deprecated aliases in 0.2 and are removed in 0.3.
- Uploads of releases choose a **track** (`track=`); without it, the only track of the app or licence is used, or a track named Releases is created. See [releases.md](releases.md#tracks).
- Files return `track`, `channel`, `changelog`, `sha256`, `withdrawn` and `withdrawn_at`; activations return `version` and `last_ip`; activity returns `ip`.

**Dashboard.** Licence list views are `?view=valid` and `?view=invalid` (the earlier names worked in 0.2 only).
