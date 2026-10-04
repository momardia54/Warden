# Checking a licence from a site

Enforcement lives in the customer site's code. Warden only reports the status of a licence.

```
GET https://<your-worker>/check/<licence key>?domain=client-site.org
```

```json
{ "name": "Harbor Studio website", "valid": true, "status": "active", "message": "", "expires_at": "2027-03-31T23:59:59.999Z", "checked_at": "2026-10-04T16:17:30.248Z" }
```

| `status` | `valid` | Meaning |
|---|---|---|
| a status key, such as `active` or `completed` | true | The status lets sites run, its expiry rule has not triggered, and the domain is allowed |
| a status key, such as `pending`, `suspended`, `disabled` or `expired` | false | The status does not let sites run. Which statuses exist, and which let sites run, is configured on the Statuses page ([statuses.md](statuses.md)) |
| `domain_mismatch` | false | The site sent a domain that is not allowed for the licence, or no domain although the licence has a site limit |
| `site_limit_reached` | false | The licence is already used on its maximum number of sites, and this domain is not one of them |
| `unknown` | false | No such key (HTTP 404) |

`status` is the key of the licence's status in the set that applies to it. The table above shows the defaults; you can add, rename and remove statuses, so decide by `valid` rather than by a fixed list of keys. `message` is the licence's public message, or the message of its status, meant to be shown to the site's owner.

## Rules of thumb for the site

1. **Check about every 12 hours**, not on every page view. Store the response (WordPress: a transient or option) with the time you got it.
2. **Fail open on errors.** If the request times out, fails, or returns a 5xx or something that is not the JSON above, keep the last known response. Only change behaviour on a response you could read and verify. A Warden outage must never lock a client out.
3. **Verify the signature** before trusting a response (below).
4. **Always send `domain`** so domain-locked licences work.
5. Decide what "not valid" does: a notice in the admin area, a maintenance page, disabling a feature. That part is yours.

## Verifying the signature

`X-Warden-Signature` is the lowercase hex HMAC-SHA256 of the **raw response body**, keyed with the licence key.

PHP:

```php
$res  = wp_remote_get( "https://your-worker.example/check/$key?domain=" . rawurlencode( $domain ), [ 'timeout' => 10 ] );
if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) >= 500 ) { return; } // keep last known state
$body = wp_remote_retrieve_body( $res );
$sig  = wp_remote_retrieve_header( $res, 'x-warden-signature' );
if ( ! hash_equals( hash_hmac( 'sha256', $body, $key ), (string) $sig ) ) { return; }      // not from Warden
$result = json_decode( $body, true );
update_option( 'my_licence_state', [ 'valid' => $result['valid'], 'status' => $result['status'], 'message' => $result['message'], 'at' => time() ] );
```

JavaScript (Node 18+ or a Worker):

```js
const res = await fetch(`https://your-worker.example/check/${key}?domain=${domain}`)
const body = await res.text()
const sig = res.headers.get("x-warden-signature")
const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("")
if (mac !== sig) throw new Error("response was not signed by Warden")
const result = JSON.parse(body)
```

Unknown keys (404) carry no signature, since there is no key to sign with. Treat a 404 as "invalid key" only if you are sure the URL is right; if you deleted the licence on purpose, that is the intended effect.
