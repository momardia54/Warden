# Roadmap

Warden is **pre-1.0** (current: 0.3.0 in progress on `develop`, 0.2.0 released). The data model, the check response and the `/api/v1` endpoints can still change between 0.x versions; changes are listed in [CHANGELOG.md](CHANGELOG.md). Version 1.0.0 means the check response and API are stable and only change in backward compatible ways.

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

### 0.2.0 (2026-10-10)

- **Releases and updates**: versions, stable and beta channels, release notes, SHA-256 checksums, withdrawal, update offers in the check response, versions in use per site and per app
- Dashboard rework: tabs, needs-attention queue with one-click extend, quick search, saved list views, CSV export
- **Analytics**: valid and invalid checks, active sites and downloads per day; top licences, files and IP addresses
- **Protection**: client IP addresses, IP blocklist, rate limits and blocking rules configured in the dashboard
- **Release tracks**: what each licence status receives (updates, final build, maintenance), one track per status, licence-specific tracks
- **Publishing from GitHub**: a GitHub App created in two clicks (or a token and a webhook); version tags published into a track, with a fixed package folder and optional tag prefixes
- Consistent terminology (valid and invalid) across the dashboard, API and docs; earlier API field names kept as deprecated aliases

## Towards 1.0.0

Version 1.0.0 freezes the check response and the API, so everything that would change them comes first. Order agreed on 2026-10-10; on 2026-10-11 product completeness moved before trust, so the security work comes last, on the finished product.

### 0.3.0: the contract

- [x] **Public-key signatures (Ed25519) on check responses.** The HMAC key was the licence key, which the site also holds, so the site's owner could forge a valid response; sites now verify with a public key only, and a nonce rejects replayed answers. Must come before 1.0: it changes the verification code every site runs
- [x] **Signed release packages (Ed25519)**, so an updater can verify a package came from you, not only that it arrived intact
- [x] **API review and freeze**: remove the deprecated aliases (`in_force`, `not_in_force`, `licenses_in_force`, `?view=in_force`), check every name against the valid/invalid vocabulary, consistent errors and pagination on every list, final review of the tracks and source endpoints
- [x] **Upgrade notes** from 0.1 and 0.2, listing each breaking change and what to do

### 0.4.0: product completeness

- [ ] **Webhooks out**: call a URL when a licence changes status, expires, or a site has not checked for N days (replaces email)
- [ ] **Grace period** per licence or app: report `valid: true` with a warning for N days after the expiry date
- [ ] **Public documentation site** (the `Warden-docs` repository, deployed) and the Deploy button verified on a clean account

### 0.5.0: trust

- [ ] **End-to-end tests on real Cloudflare**: the GitHub App flow with a real app, private repositories with a token, phone-width layout, and CI that deploys a throwaway Worker and runs the checks against it
- [ ] **Backups and export**: documented and tested D1 export and restore, and a data export from the dashboard
- [ ] **Dashboard sign-in hardening**: two-factor authentication for the admin, or documented use of Cloudflare Access in front of the dashboard
- [ ] **An independent security review** of the check, download, webhook and API code

### 1.0.0: stable

- [ ] Remove what 0.3.0 deprecated: the `X-Warden-Signature` header (HMAC) and `before` on `GET /licenses`
- [ ] Freeze the check response and `/api/v1`; from here, only backward compatible changes within a major version

### After 1.0.0

- CSV import of licences, staged rollouts, files over 100 MB (direct-to-R2 uploads), download limits and signed download links, more release sources (GitLab, Bitbucket, a `Version:` header trigger, GitHub release assets)

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
