# Warden

Self-hosted licence manager for Cloudflare Workers. Create a licence for a client site, get a **licence key** and a **check URL**, and change its status (pending, active, suspended, disabled, expired) from a dashboard.

Warden only creates and manages licences. **Enforcement lives in your site's code**: the site calls the check URL (for example every 12 hours) and decides what to do with the answer.

## Check URL

`GET` or `POST https://<your-worker>/check/<licence key>?domain=client-site.org`

```json
{ "name": "OCWOF website", "valid": true, "status": "active", "message": "", "expires_at": null, "checked_at": "2026-10-04T16:17:30.248Z" }
```

| Field | Meaning |
|---|---|
| `valid` | `true` only when the status is `active`, the end date has not passed and the domain (if the licence lists any) matches |
| `status` | `active`, `pending`, `suspended`, `disabled`, `expired`, `domain_mismatch` or `unknown` |
| `message` | The message you set on the licence, or a default for the status |

- Known key: HTTP 200. Unknown key: HTTP 404 with `status: "unknown"`.
- Header `X-Warden-Signature`: HMAC-SHA256 (hex) of the response body, keyed with the licence key. Verify it in the site to be sure the answer is genuine.
- An active licence whose end date has passed is reported as `expired` without any edit.
- Recommended in the site: act only on a parsed answer with `valid: false`; on network errors or 5xx keep the last known state, so a Warden outage never locks a client out.

## Dashboard

Overview, licence list (search and status filter), licence page (key, check URL, status change, extend 30/90/365 days, regenerate key, activity log, delete). Single admin, login from the Worker secrets `ADMIN_USERNAME` and `ADMIN_PASSWORD` (optional `SESSION_SECRET`).

## Run and deploy

```
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
printf 'ADMIN_USERNAME="admin"\nADMIN_PASSWORD="a-long-password"\n' > .dev.vars
npm install && npm run dev      # http://localhost:5173
npm test
npm run deploy                  # Worker + D1, tables are created on first request
```

Set the secrets after deploying: `npx wrangler secret put ADMIN_USERNAME` and `ADMIN_PASSWORD`. A daily Cron Trigger deletes check history older than 90 days.
