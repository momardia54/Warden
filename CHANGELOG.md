# Changelog

Warden is pre-1.0: the API and data model can change between 0.x versions.

## 0.1.0 (unreleased)

### Added: releases and updates

- A file with a version is a **release**. Releases have a channel (`stable` or `beta`), public release notes and a SHA-256 checksum computed during the upload, and can be **withdrawn** and restored. A withdrawn release is not listed and its download returns `410`
- The check endpoint accepts `version` (and `channel`) and answers with an `update` block: the newest release the licence can download for that domain and whether it is newer. The version is recorded for the site
- Versions are validated (`1.4.0`, `v2.1`, `2.0.0-beta.1`) and compared by semantic versioning precedence: `2.0.0-rc.1` now ranks below `2.0.0` (before, the suffix was ignored)
- Downloads carry `X-Warden-Sha256`; the download list includes `channel`, `changelog` and `sha256`, accepts `channel=beta`, and no longer includes the file's internal `notes`
- API: upload accepts `channel` and `changelog`; `PATCH` on a file accepts `channel`, `changelog` and `withdrawn`; files return `channel`, `changelog`, `sha256`, `withdrawn`, `withdrawn_at`; activations return `version`; new `GET /apps/{app}/versions`
- Migration 0007 (file channel, release notes, checksum, withdrawal; the version of each site)
- docs/releases.md

### Added: protection

- The **IP address** of every check and download is recorded and shown in the activity log, on each site, in Analytics (top addresses) and in the API (`ip`, `last_ip`); quick search finds licences by address. Addresses are cleared after 90 days
- **Block an IP address or range** from any address in the dashboard, or directly on the new **Protection** page, for 1, 7 or 30 days or permanently, with a reason. Blocked clients receive `403` (`status: blocked`) on checks and downloads before any licence is read; the dashboard and the API are never blocked by address
- **Rate limits**, set in the dashboard: checks per address, checks per licence key, downloads per address and API requests per key (30 to 1,200 per minute, or off). Over a limit: `429` with `Retry-After`, and no verdict on checks
- **Blocking rules**, each with a threshold, a time window and a block duration: invalid licence keys (enabled), invalid checks, licences per IP address, rate limit violations (enabled). An allowlist exempts your own servers
- Analytics shows blocked and rate-limited requests
- API: `GET/POST /ip-blocks`, `DELETE /ip-blocks/{id}`, `GET/PATCH /protection`
- Migrations 0009 (IP addresses, blocklist, rejected request counts) and 0010 (settings, rule-based blocks, rule events)
- docs/protection.md

### Added: analytics

- **Analytics** page: valid and invalid checks per day, active sites and downloads per day, invalid checks by reason, top licences by checks and top files by downloads, over 7, 30 or 90 days, for every licence, one app or the standalone licences
- Checks of the last 30 days on the overview and on each licence's Activity tab
- Charts can be read by hovering, with the keyboard, or as a table; the charts on the overview, an app and a licence have **View all**, and ranked lists show eight rows with **View all** for up to 100
- API: `GET /analytics` (`days`, `app`, `license`)
- Migration 0008: index on activity (event, at), so each figure reads only checks or only downloads
- docs/analytics.md

### Added: dashboard

- Licence and app pages rebuilt around a summary strip (what sites see, expiry, sites, last check; licences, sites, latest release, sites on an old version) and tabs that are kept in the address
- Release manager: upload dialog with drag and drop, version filled in from the file name, channel and release notes; releases listed by version with the latest marked; edit, copy link or checksum, withdraw, restore and delete from a menu
- Versions in use per app, and per site on the licence page with "Update available"
- Overview with a *Needs attention* queue (expiring licences with one-click extend, silent licences), apps with sites on an old version, links from every number to the matching list, and recent activity across all licences
- Licence list: quick views (valid, invalid, expiring, no recent check), filters and sorting kept in the address, clickable rows, expiry shown as "in 5 days", and CSV export of the filtered list (spreadsheet formulas are neutralised)
- Quick search with Ctrl+K or Cmd+K (or `/`): licences by name, customer, key, reference or registered site domain, apps and pages
- Activity tab with filters for changes, checks and downloads
- File actions in the dashboard now report errors instead of failing silently

### Fixed

- The OpenAPI description listed only the built-in statuses for `status` filters and bodies, and described `valid` as "true for active and completed"; both now reflect configurable statuses

### Fixed (review)

- Downloads of files whose names are not plain ASCII (for example `主题.zip`) failed with an error: the header now carries an ASCII name and the exact UTF-8 name (`filename*`)
- HEAD requests on a download were counted and logged as downloads
- Deleting a status could change the release rule of a file that used a similar status key (`_` was treated as a wildcard); keys are now matched exactly
- The API status filter (`GET /licenses?status=`) built one SQL condition per customised app or licence and would exceed D1's limit of 100 bound values; it now filters in batches
- A malformed percent-encoded domain in `DELETE /licenses/{id}/activations/{domain}` returned an error page instead of `400`
- Two apps created at the same moment with the same identifier returned an error page instead of the duplicate-identifier message
- The sidebar links carried the source text of a function as a CSS class (and caused a hydration warning)
- "Extend expiry" is no longer offered for a licence without an expiry date, which it would have given one

### Security hardening (review)

- Downloads are sent with `Content-Security-Policy: default-src 'none'; sandbox`
- API and check request bodies are read only up to their limit, even without a Content-Length header
- API keys use an unbiased random generator; API responses carry `X-Content-Type-Options: nosniff`
- Oversized login fields are rejected before hashing and count as a failed attempt
- Removed the unused chart component and the `recharts` dependency

- Licences with key and check URL, five statuses, expiry dates, allowed domains, message for the site, private notes
- Signed check responses (`X-Warden-Signature`), activity log, overview
- Extend (30, 90, 365 days) and regenerate key
- API under `/api/v1` with `read`, `manage` and `full` keys: list (filter, search, paging), create (idempotent through `external_ref`), get, patch, status, renew, regenerate key, delete, activity, stats, OpenAPI description at `/api/v1/openapi.json`
- Dashboard page for API keys (shown once, stored as SHA-256 hashes, revocable)
- Status **completed** (paid in full): valid and permanent
- **Files per licence** stored in R2 (binding `FILES`), up to 100 MB, each with a release rule (licence statuses it is available in, optional domain check). Gated `/download/<key>[/<file id>]`, download counters and log, upload, edit and delete in the dashboard and by API
- **Apps**: a product licensed to many customers. Defaults for new licences (status, duration, maximum sites, public message), licences listed per app, files shared by all licences of an app, `latest` version in the download list, API under `/api/v1/apps`
- **Site limit and activations**: a licence can limit the number of sites; sites register on their first check and can be released. New check result `site_limit_reached`
- **Configurable statuses** at app level and licence level. A licence in an app uses its app's statuses; a standalone licence can have its own; everything else uses the built-in defaults (pending, active, completed, suspended, disabled, expired). Statuses can be renamed, changed, reordered, removed and extended. Each has a colour (any hex colour, with a picker and presets), a "sites can run" flag, an expiry rule and a message to sites. Editors on the app and licence pages, and in the create forms (the statuses are stored together with the new app or licence), and `/apps/{app}/statuses`, `/licenses/{id}/statuses` in the API. `GET /stats` now returns `in_force`, `not_in_force` and `by_status`
- Licences have `customer_name` and `customer_email` (`client` was renamed)
- Migrations 0001 (schema), 0002 (API keys, `external_ref`), 0003 (files), 0004 (file release rules, `activity.event`) and 0005 (apps, activations, shared files, customer fields) and 0006 (statuses)
- Docs: README, docs/api.md, docs/apps.md, docs/checking.md, docs/files.md, docs/statuses.md, Security.md, Roadmap.md, Licence.md
