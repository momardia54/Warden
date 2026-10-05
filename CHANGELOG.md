# Changelog

Warden is pre-1.0: the API and data model can change between 0.x versions.

## 0.1.0 (unreleased)

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
