# Protection: IP addresses, blocks, rate limits and automatic rules

The **Protection** page (sidebar) controls who may call your check and download URLs and how often. It has three tabs: **Blocked IPs**, **Rate limits** and **Automatic blocking**. Everything here applies to the public endpoints, `/check/…` and `/download/…`. The dashboard is protected by its login, and the API by its keys (plus a rate limit per key). Neither is ever blocked by address, so you cannot lock yourself out.

## IP addresses

Warden records the address of the caller (Cloudflare's `CF-Connecting-IP`) on every check and download:

- In the licence's **Activity** tab, under each check and download.
- In the licence's **Sites** tab (the address a site last checked from).
- In **Analytics**, under **Top addresses**: checks, refused checks, downloads and the number of licences per address.
- In the API: `ip` on activity entries, `last_ip` on sites.
- In search (Ctrl+K): an address finds the licences whose sites checked from it.

Click any address for its menu: copy it, or **Block this IP…**.

The caller of a check is normally the server the customer's site runs on, not a visitor. Addresses are kept with the checks for 90 days. Downloads stay on record, but their address is cleared after 90 days.

## Blocked IPs

A blocked address or range gets `403` on every check and download, before any licence is read:

```json
{ "valid": false, "status": "blocked", "message": "Requests from this address are blocked." }
```

- Block one address (`203.0.113.5`, `2001:db8::5`) or a range (`203.0.113.0/24`, `2001:db8::/32`). Ranges wider than /8 (IPv4) or /16 (IPv6) are refused.
- A block lasts 1 day, 7 days, 30 days or until removed. Expired blocks stay listed, marked *Expired*, and are deleted 30 days after they end.
- Each block shows its reason, how many requests it refused and when it last refused one. The counts are approximate (see below).
- **Automatic** marks blocks made by a rule.
- A new or removed block applies at once on the Cloudflare instance that saved it, and within 30 seconds everywhere.

Several sites on one shared host can use the same address, and blocking it blocks them all. To stop one customer, suspend their licence or regenerate its key instead.

## Rate limits

| Limit | Default | Counted |
|---|---|---|
| Checks per address | 120 per minute | from one IP address |
| Checks per licence key | 60 per minute | for one key, from any address |
| Downloads per address | 30 per minute | from one IP address |
| API requests per API key | 600 per minute | with one API key |

Each limit can be set to 30, 60, 120, 300, 600 or 1,200 requests per minute, or turned off.

Over a limit, the request gets `429 Too Many Requests` with `Retry-After: 60`:

```json
{ "error": "Too many requests. Try again in a minute.", "status": "rate_limited" }
```

A rate-limited check carries **no verdict** (`valid` is absent). A site that follows the rules in [checking.md](checking.md) keeps its last answer and keeps running.

How it works: limits use Cloudflare's Workers rate limiting. `wrangler.jsonc` declares one counter per value (`RATE_LIMIT_30` … `RATE_LIMIT_1200`), and the setting picks which one counts. Cloudflare keeps the counts per location and they are approximate, so a caller spread over many locations can go somewhat over a limit. If a counter is unavailable, the request goes through: a limiter problem never takes sites down.

## Automatic blocking

A rule blocks an address by itself when the address goes past a threshold within a window. Each rule is written as a sentence you adjust: *Block an address for **1 day** after **20** checks or downloads with a key that does not exist within **10 minutes***.

| Rule | Counts | Default |
|---|---|---|
| Guessing licence keys | checks and downloads with a key that does not exist | **on**: 20 in 10 minutes, block 1 day |
| Refused checks | checks answered as not valid (suspended or expired licence, wrong domain, site limit reached) | off: 50 in 10 minutes, block 1 day |
| Many licences from one address | different licences checked from the address | off: 25 in 1 hour, block 1 day |
| Staying over a rate limit | minutes in which the address went over a rate limit (counted at most once a minute) | **on**: 5 in 10 minutes, block 1 hour |

- **Windows:** 5, 10, 30 or 60 minutes, 6 hours or 1 day.
- **Block lengths:** 1 hour, 6 hours, 1 day, 7 days, 30 days or until removed.
- **Thresholds:** 2 to 10,000.

Two rules are off by default because legitimate traffic can trip them:

- **Refused checks:** a customer whose licence you suspended may have a site that checks on every page view.
- **Many licences:** one hosting company can run many of your customers' sites from a single address.

If you turn them on, set the threshold above your largest legitimate host.

**Never block automatically** lists addresses and ranges (up to 50) that are never rate limited and that no rule blocks: your own servers, monitoring, a host you trust. A block you add yourself still applies to them.

Each automatic block gives its reason, for example *Automatic: 20 checks or downloads with a key that does not exist in 10 minutes (rule "Guessing licence keys", 1 day)*. Remove it like any other block.

The rules run after the answer is sent, so they never slow a check down. Nothing is recorded for a rule that is off. Unknown keys and rate-limit hits are kept for one day, which is why no window is longer.

## Counts in Analytics

Analytics shows **Refused before any licence was read** for the whole installation: requests from a blocked address and requests over a rate limit. These requests belong to no licence, so the figures are hidden when Analytics is filtered on an app or a licence. Each Cloudflare instance keeps them in memory and writes them at most once a minute. Counts still in memory when an instance stops are lost, so the figures are approximate.

## API

| Method and path | Scope | What it does |
|---|---|---|
| `GET /ip-blocks` | read | Blocks: `{ id, ip, source, reason, created_at, expires_at, hits, last_hit_at }` |
| `POST /ip-blocks` | manage | `{ "ip": "203.0.113.0/24", "reason": "…", "expires_at": "2026-11-01T00:00:00Z" }` (`expires_at` null or absent = until removed) |
| `DELETE /ip-blocks/{id}` | manage | Remove a block |
| `GET /protection` | read | The settings: `limits`, `rules`, `never_block` |
| `PATCH /protection` | full | Change only what you send, for example `{ "limits": { "check_ip": 300 }, "rules": { "refused_checks": { "enabled": true, "count": 100 } } }` |
