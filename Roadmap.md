# Roadmap

Warden is **pre-1.0**. The data model, the check response and the `/api/v1` endpoints can still change between 0.x versions; changes are listed in [CHANGELOG.md](CHANGELOG.md). Version 1.0.0 means the check response and API are stable and only change in backward compatible ways.

This is a plan, not a promise. Order can change.

## Done (0.1.x)

- Licences with key, check URL, five statuses, expiry dates, allowed domains, message for the site, private notes
- Signed check responses (`X-Warden-Signature`), activity log
- Dashboard: overview, licence list, licence page, extend, regenerate key
- API with keys and scopes: create (idempotent with `external_ref`), read, edit, status, renew, regenerate key, delete, activity, stats, OpenAPI description
- Daily clean-up of old check history
- **Configurable statuses** with an expiry rule, a message and colour per status, and optional statuses per app
- **Apps**: licences issued under an app with defaults, a site limit with automatic site registration, and shared releases with a "latest version" pointer
- Status **completed** (paid in full) and **files per licence** in R2: per-file release rules by licence status, gated downloads, download log, upload by dashboard or API

## Next (towards 1.0.0)

- [ ] **Webhooks out**: call a URL when a licence changes status, expires, or when a site has not checked for N days (replaces email, same approach as the other tools in this folder)
- [ ] **Rate limiting** for the API and the check URL
- [ ] **Public-key signatures** (Ed25519) so a site holds only a public key and cannot forge responses
- [ ] **Grace period** per licence: report `valid: true` with a warning for N days after the expiry date
- [ ] **Import and export** of all licences as JSON/CSV
- [ ] **Renewal reminders** in the dashboard: a list of licences ending soon with a one-click extend
- [ ] **Tests against a real Worker** in CI (today: unit tests plus a local D1 stand-in and manual runs)
- [ ] **SHA-256 checksum** for each file, shown in the listing, so an updater can verify what it downloaded
- [ ] **Larger files**: direct-to-R2 uploads for files over 100 MB, and range (resumable) downloads
- [ ] **Download limits** and time-limited, signed download links
- [ ] **Docs site** and a one-click deploy button once the repository is public
- [ ] Review of the whole API surface and the response format, then freeze for 1.0.0

## Later, if there is demand

- Several admins and per-licence API keys
- Plans within an app (for example 1 site, 5 sites, unlimited) as named templates for duration and site limit
- Check statistics per licence over time
- Official client snippets (PHP/WordPress, JavaScript) kept in this repository
- Audit log for dashboard and API changes

## Not planned

- Taking payments. Warden records licence state; use your payment tool and call the API from its webhook.
- Email sending (no SMTP in this tool, by design).
- Making a licence impossible to bypass on a server you do not control (see [Security.md](Security.md)).
