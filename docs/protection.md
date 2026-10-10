# Protection: IP blocklist, rate limits and blocking rules

The **Protection** page (sidebar) controls access to the public endpoints, `/check/…` and `/download/…`. It has three tabs:

![The blocking rules on the Protection page](screenshots/protection.jpg)

- **IP blocklist**
- **Rate limits**
- **Blocking rules**

IP blocking never applies to the dashboard or the API. The dashboard is protected by its login, and the API by its keys (with a rate limit per key).

## IP addresses

Warden records the client IP address (`CF-Connecting-IP`) of every check and download. It appears in:

- the licence's **Activity** log, under each check and download;
- the licence's **Sites** tab, as the IP address of each site's latest check;
- **Analytics**, under **Top IP addresses**: checks, invalid checks, downloads and distinct licences per address;
- the API: `ip` on activity entries, `last_ip` on sites;
- quick search (Ctrl+K): an IP address finds the licences checked from it.

Select an address for its menu: **Copy IP address** or **Block IP address…**.

The client of a check is normally the server hosting the customer's site, not a visitor. IP addresses are retained for 90 days: check records are deleted after 90 days, and the address is cleared from download records after the same period.

## IP blocklist

Checks and downloads from a blocked address receive HTTP 403 before any licence is read:

```json
{ "valid": false, "status": "blocked", "message": "Requests from this address are blocked." }
```

- **Entries:** a single address (`203.0.113.5`, `2001:db8::5`) or a CIDR range (`203.0.113.0/24`, `2001:db8::/32`). Ranges wider than /8 (IPv4) or /16 (IPv6) are not accepted.
- **Block duration:** 1 day, 7 days, 30 days or permanent. Expired entries remain listed as *Expired* and are deleted 30 days after expiry.
- **Per entry:** the reason, the number of blocked requests and the time of the last one. The counts are approximate (see below).
- **Rule badge:** entries added by a blocking rule carry the badge **Rule**.
- **Propagation:** changes take effect immediately on the Cloudflare instance that saved them and within 30 seconds everywhere.

Sites on a shared server use the same IP address, so blocking it affects all of them. To stop a single customer, suspend the licence or regenerate its key instead.

## Rate limits

| Limit | Counted per | Default |
|---|---|---|
| Checks per IP address | client IP address | 120 per minute |
| Checks per licence key | licence key, across all IP addresses | 60 per minute |
| Downloads per IP address | client IP address | 30 per minute |
| API requests per API key | API key | 600 per minute |

Each limit can be set to 30, 60, 120, 300, 600 or 1,200 requests per minute, or disabled. Requests over a limit receive HTTP 429 with `Retry-After: 60`:

```json
{ "error": "Too many requests. Try again in a minute.", "status": "rate_limited" }
```

A rate-limited check returns no licence verdict (no `valid` field). A site that follows [checking.md](checking.md) keeps its last valid response and continues to run.

**Implementation.** Limits use Workers rate limiting. `wrangler.jsonc` declares one counter per value (`RATE_LIMIT_30` to `RATE_LIMIT_1200`), and the setting selects the counter. Counters are maintained per Cloudflare location and are approximate: a client distributed across several locations can exceed a limit. If a counter is unavailable, requests are allowed, so a limiter failure never takes sites offline.

## Blocking rules

When an address reaches a rule's **threshold** within the **time window**, it is added to the IP blocklist for the **block duration**.

| Rule | Counts | Default |
|---|---|---|
| Invalid licence keys | Checks and downloads that use a licence key that does not exist (key enumeration) | Enabled: 20 within 10 minutes, blocked for 1 day |
| Invalid checks | Checks answered with `valid: false`: an invalid status, a domain that is not allowed, a site limit reached | Disabled: 50 within 10 minutes, blocked for 1 day |
| Licences per IP address | Distinct licences checked from the address | Disabled: 25 within 1 hour, blocked for 1 day |
| Rate limit violations | Minutes in which the address exceeded a rate limit (at most one per minute) | Enabled: 5 within 10 minutes, blocked for 1 hour |

- **Thresholds:** 2 to 10,000.
- **Time windows:** 5, 10, 30 or 60 minutes, 6 hours or 1 day.
- **Block durations:** 1 hour, 6 hours, 1 day, 7 days, 30 days or permanent.

*Invalid checks* and *Licences per IP address* are disabled by default because legitimate traffic can reach them:

- a suspended customer site may check on every page view;
- a hosting provider may serve many of your customers from one address.

Before enabling them, set the threshold above your largest legitimate host.

**Allowlist.** Up to 50 IP addresses or CIDR ranges that are exempt from rate limits and blocking rules, for example your own servers or monitoring services. Addresses you block manually remain blocked.

**Reasons.** Each entry added by a rule records its reason, for example *Rule "Invalid licence keys": 20 requests with an invalid licence key in 10 minutes.*

**Performance and retention.** Rules are evaluated after the response is sent and add no latency. Nothing is recorded for a disabled rule. Invalid-key requests and rate limit violations are retained for one day, which is the longest time window.

## Analytics

Analytics shows **Blocked and rate-limited requests**: checks and downloads rejected before licence validation. They cannot be attributed to a licence, so they are shown only when Analytics covers all licences. Each Cloudflare instance counts them in memory and writes them at most once per minute; counts held by an instance that stops are lost, so the figures are approximate.

## API

| Method and path | Scope | Description |
|---|---|---|
| `GET /ip-blocks` | read | Blocklist entries: `{ id, ip, source, reason, created_at, expires_at, hits, last_hit_at }`; `source` is `manual` or `auto` |
| `POST /ip-blocks` | manage | `{ "ip": "203.0.113.0/24", "reason": "…", "expires_at": "2026-11-01T00:00:00Z" }` (`expires_at` null or absent for a permanent block) |
| `DELETE /ip-blocks/{id}` | manage | Remove an entry |
| `GET /protection` | read | Settings: `limits`, `rules`, `never_block` (the allowlist) |
| `PATCH /protection` | full | Partial update, for example `{ "limits": { "check_ip": 300 }, "rules": { "invalid_checks": { "enabled": true, "count": 100 } } }` |

Limit keys: `check_ip`, `check_key`, `download_ip`, `api_key`. Rule keys: `invalid_keys`, `invalid_checks`, `licenses_per_ip`, `rate_limit_violations`, each with `enabled`, `count`, `minutes` and `block_hours` (0 = permanent).
