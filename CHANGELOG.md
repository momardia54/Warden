# Changelog

Warden is pre-1.0: the API and data model can change between 0.x versions.

## 0.1.0 (unreleased)

- Licences with key and check URL, five statuses, end dates, allowed domains, message for the site, private notes
- Signed check answers (`X-Warden-Signature`), activity log, overview
- Extend (30, 90, 365 days) and regenerate key
- API under `/api/v1` with `read`, `manage` and `full` keys: list (filter, search, paging), create (idempotent through `external_ref`), get, patch, status, renew, regenerate key, delete, activity, stats, OpenAPI description at `/api/v1/openapi.json`
- Dashboard page for API keys (shown once, stored as SHA-256 hashes, revocable)
- Migrations 0001 (schema) and 0002 (API keys, `external_ref`)
- Docs: README, docs/api.md, docs/checking.md, Security.md, Roadmap.md, Licence.md
