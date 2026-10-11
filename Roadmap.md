# Roadmap

Warden is **pre-1.0** (current: 0.2.0 on `develop`, 0.1.0 released). The data model, the check response and the `/api/v1` endpoints can still change between 0.x versions; changes are listed in [CHANGELOG.md](CHANGELOG.md). Version 1.0.0 means the check response and API are stable and only change in backward compatible ways.

This is a plan, not a promise. Order can change.

## Versioning

Warden uses [semantic versioning](https://semver.org/). The version is in `package.json` and `app/lib/version.ts` (a test keeps them equal), on the dashboard (account menu) and in `/api/v1/openapi.json`.

- **Before 1.0.0**, a minor version (0.x.0) adds features and may change the check response, the API or the data model. Every such change is listed under **Changed** or **Removed** in [CHANGELOG.md](CHANGELOG.md), with what to do; renamed API fields keep their old name as a deprecated alias until 1.0.0. A patch version (0.x.y) only fixes bugs.
- **From 1.0.0**, the check response and `/api/v1` only change in backward compatible ways within a major version.
- **Database migrations** only move forward and run by themselves on the first request after an update. A migration that has been released is never edited.
- **Releasing**: `develop` is merged into `main` through a pull request, the merge commit is tagged `vX.Y.Z`, and the changelog section `X.Y.Z (unreleased)` gets its date. The Deploy button installs `main`.

## Released

### 0.1.0 (2026-10-04)

- Licences with key, check URL, statuses, expiry dates, allowed domains, message for the site, private notes
- Signed check responses (`X-Warden-Signature`), activity log, daily clean-up of old check history
- **Configurable statuses** at app and licence level, with an expiry rule, a message and a free colour per status
- **Apps**: licences issued under an app with defaults, a site limit with automatic site registration, shared files with a "latest version" pointer
- Status **completed** (paid in full) and **files** in R2: per-file release rules by licence status, gated downloads, download log, upload by dashboard or API
- API with keys and scopes, idempotent creation with `external_ref`, OpenAPI description

## 0.2.0 (ready on `develop`, not released)

- **Releases and updates**: versions, stable and beta channels, release notes, SHA-256 checksums, withdrawal, update offers in the check response, versions in use per site and per app
- Dashboard rework: tabs, needs-attention queue with one-click extend, quick search, saved list views, CSV export
- **Analytics**: valid and invalid checks, active sites and downloads per day; top licences, files and IP addresses
- **Protection**: client IP addresses, IP blocklist, rate limits and blocking rules configured in the dashboard
- **Release tracks**: what each licence status receives (updates, final build, maintenance), one track per status, licence-specific tracks
- **Publishing from GitHub**: a GitHub App created in two clicks (or a token and a webhook); version tags published into a track, with a fixed package folder and optional tag prefixes
- Consistent terminology (valid and invalid) across the dashboard, API and docs; earlier API field names kept as deprecated aliases

## Towards 1.0.0

A proposed order; it can change.

### 0.3.0: operations

- [ ] **Tests against a real Worker** in CI (today: unit tests with a local D1 stand-in, and manual runs)
- [ ] **Webhooks out**: call a URL when a licence changes status, expires, or when a site has not checked for N days (replaces email)
- [ ] **Grace period** per licence: report `valid: true` with a warning for N days after the expiry date
- [ ] **Import** of licences from CSV (export is done)

### 0.4.0: trust

- [ ] **Public-key signatures** (Ed25519) so a site holds only a public key and cannot forge responses
- [ ] **Signed releases** (Ed25519) so an updater can verify a package came from you, not only that it arrived intact
- [ ] **Download limits** and time-limited, signed download links

### 0.5.0: distribution

- [ ] **More release sources**: GitLab and Bitbucket, a trigger on a raised `Version:` header (WordPress style) in pushed commits, and GitHub release assets for projects with a build step
- [ ] **Staged rollouts**: offer a release to a percentage of sites first
- [ ] **Larger files**: direct-to-R2 uploads for files over 100 MB, and range (resumable) downloads

### 1.0.0: stable

- [ ] Review of the whole API surface and the check response, then freeze
- [ ] Remove the deprecated aliases (`in_force`, `not_in_force`, `licenses_in_force`, `?view=in_force`)
- [ ] Upgrade notes from every 0.x version
- [ ] **Docs site** and a one-click deploy button once the repository is public

## Later, if there is demand

- Several admins and per-licence API keys
- Plans within an app (for example 1 site, 5 sites, unlimited) as named templates for duration and site limit
- Long-term traffic history beyond the 90 days of checks kept (a daily summary table)
- Official client snippets (PHP/WordPress, JavaScript) kept in this repository
- Bulk actions in the licence list (change status, extend several licences at once)
- Audit log for dashboard and API changes

## Not planned

- Taking payments. Warden records licence state; use your payment tool and call the API from its webhook.
- Email sending (no SMTP in this tool, by design).
- Making a licence impossible to bypass on a server you do not control (see [Security.md](Security.md)).
