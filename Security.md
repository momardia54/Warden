# Security

Warden is **pre-1.0** (see [Roadmap.md](Roadmap.md)). It has had no independent security audit. Use it for what it is, a licence switch for your own client sites, and read the limits below before relying on it.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately to the maintainer by email at **momar.web54@gmail.com**, or through GitHub's "Report a vulnerability" button on the repository (Security tab) once it is public. Include what you found, how to reproduce it, and which version. You will get an acknowledgement, and a fix or a clear answer, as fast as one person can manage. Credit is given unless you prefer otherwise.

Supported versions: only the latest release (there is no 1.0 yet, so none is long-term supported).

## What Warden protects, and how

| Area | Design |
|---|---|
| Dashboard login | One admin, from the Worker secrets `ADMIN_USERNAME` and `ADMIN_PASSWORD`. Credentials are compared in constant time. The session cookie is an opaque random token (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS); the server keeps only its hash, so logging out or changing the password ends the session. |
| Brute force | 8 failed logins per IP per 15 minutes locks that IP out; a global delay slows distributed guessing. IPs are stored hashed. |
| CSRF | Every dashboard action rejects cross-origin posts, on top of `SameSite=Lax`. |
| Dashboard pages | Strict Content-Security-Policy with a per-request nonce, `X-Frame-Options: DENY`, `no-store` caching, HSTS on HTTPS. |
| API keys | `wk_` plus 40 random characters. Only a SHA-256 hash is stored; the key is shown once. Three scopes (`read`, `manage`, `full`), revocable at any time. Keys act as the admin account, so give each app its own key with the least access it needs. |
| Licence keys | `WRD-` plus 20 random characters from a 30-symbol alphabet (about 98 bits), generated with the platform's secure random source. Unknown keys get a generic 404. |
| Check answers | Signed: `X-Warden-Signature` is the HMAC-SHA256 of the body, keyed with the licence key. A site can verify an answer is genuine and unmodified. |
| Database | Cloudflare D1, queries use bound parameters throughout. Check history older than 90 days is deleted daily. No visitor IPs are stored for checks; only the domain a site reports. |

## Limits you should know about

- **Enforcement is in your site's code, and the client controls the site.** Anyone who can edit the code on a server can remove the check. Warden tells your code what the licence status is; it cannot make a determined owner of a site comply. Treat it as a way to run a clear, fair commercial arrangement, together with a written agreement, not as copy protection.
- **Licence keys are stored readable** (the dashboard and API show them again on demand). Anyone with access to your D1 database or an API key can read them. Protect your Cloudflare account with a strong password and two-factor authentication.
- **The signature secret is the licence key**, which the site also holds. It proves an answer was not tampered with in transit, not that the site's owner could not fake the server. Asymmetric (public key) signatures are on the roadmap.
- **No rate limiting on the API or the check URL** yet. Keys are long and random, so guessing is not practical, but a leaked key can be used without limit until you revoke it. Cloudflare's own WAF rate limiting rules can be put in front of `/api/*` and `/check/*` meanwhile.
- **Single admin.** There are no separate users or roles. API key scopes are the only separation.
- **CORS is open (`*`) on `/check/*` and `/api/*`.** Those endpoints do not use cookies, so a web page cannot use your dashboard session against them; they authenticate with the key in the address or the `Authorization` header.
- Not a general-purpose secret store. Do not put passwords or personal data in licence notes.

## Hardening checklist

1. Use a long random `ADMIN_PASSWORD` (12+ characters) and set `SESSION_SECRET` (`openssl rand -hex 32`).
2. Turn on two-factor authentication for the Cloudflare account that hosts Warden.
3. Create one API key per app, with the lowest scope that works. Revoke keys you no longer use.
4. In the client site, act only on an explicit answer (`valid: false`) and keep the last known state when Warden cannot be reached, so an outage never locks a client out.
5. Verify the `X-Warden-Signature` header in the site (see [docs/checking.md](docs/checking.md)).
6. Put a Cloudflare rate-limiting rule on `/api/*` if you expose keys to third-party systems.
