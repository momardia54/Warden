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
- Migrations 0001 (schema), 0002 (API keys, `external_ref`), 0003 (files) and 0004 (file release rules, `activity.event`)
- Docs: README, docs/api.md, docs/checking.md, docs/files.md, Security.md, Roadmap.md, Licence.md
