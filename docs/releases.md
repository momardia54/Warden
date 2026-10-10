# Releases and updates

Warden can deliver the updates of what you sell. A **release** is a file with a version. It is stored in R2 like any other file ([files.md](files.md)) and keeps the same release rule: the licence statuses in which it can be downloaded, and whether the site's domain must match. On top of that, a release has a channel, public release notes and a checksum, and the check endpoint tells each site whether a newer release is waiting for it.

A file **without** a version is an *attachment* (a manual, a notice). It can be downloaded but is never offered as an update.

## What a release has

| Field | Meaning |
|---|---|
| **Version** | Numbers separated by dots (one to four), an optional leading `v`, an optional pre-release suffix and an optional build suffix. Examples: `1.4.0`, `v2.1`, `2.0.0-beta.1`, `2.0.0+build.7`. Versions are compared by semantic versioning precedence: `1.10.0` is newer than `1.9.2`, `2.0` equals `2.0.0`, and `2.0.0` is newer than `2.0.0-rc.1`. |
| **Channel** | `stable` (default) or `beta`. Sites receive stable releases unless they ask for the beta channel, in which case they receive the newest of both. |
| **Release notes** | Public text (up to 10,000 characters) returned with the release, so a site can show "what's new" before installing. |
| **Checksum** | The SHA-256 of the file, computed by Warden during the upload. Returned with the release and sent as the `X-Warden-Sha256` header of the download, so an updater can verify what it received. Files uploaded before checksums were introduced have none. |
| **Withdrawn** | A withdrawn release is no longer offered, no longer listed, and its download returns HTTP 410. It stays on record and can be restored. Use it to pull a bad build without losing its history. |
| **Internal notes** | For you only. Never sent to sites. |

Releases live where the product lives: on the **app** for a product sold to many customers (every licence of the app sees them), or on a **licence** for a one-off project.

## Offering updates through the check

A site that sends its installed version with its regular check gets an `update` block back:

```
GET https://<your-worker>/check/<licence key>?domain=harborstudio.com&version=1.3.0
```

```json
{
  "valid": true,
  "status": "active",
  "message": "",
  "name": "Harbor Studio website",
  "app": { "slug": "harbor-theme", "name": "Harbor Theme" },
  "expires_at": "2027-10-04T23:59:59.999Z",
  "checked_at": "2026-10-10T09:12:44.512Z",
  "update": {
    "current": "1.3.0",
    "available": true,
    "latest": {
      "id": "fil_...",
      "name": "harbor-theme-1.4.0.zip",
      "version": "1.4.0",
      "channel": "stable",
      "changelog": "Faster gallery. Fixes the mobile menu.",
      "size": 3145728,
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "released_at": "2026-10-08T14:03:11.000Z",
      "download_url": "https://<your-worker>/download/WRD-.../fil_...?domain=harborstudio.com"
    }
  }
}
```

- `latest` is the newest release this licence can download **right now**, for this domain, in the site's channel: the release rule is applied exactly as for a download. A suspended licence is offered nothing; a release published only for Completed licences is offered once the licence is Completed.
- `available` is `true` when `latest` is newer than `current`.
- `download_url` already carries the domain, so the site can fetch it as is.
- Add `&channel=beta` to receive beta releases too.
- The whole response, `update` included, is signed with `X-Warden-Signature` ([checking.md](checking.md)).
- The `update` block appears only when the site sends a valid `version`. Older site code that does not send one gets the same response as before.

The same fields can be sent in a POST body: `{ "domain": "harborstudio.com", "version": "1.3.0", "channel": "beta" }`.

## Knowing which versions are installed

The version a site sends is recorded with the site (its activation). The dashboard shows it:

- On a **licence**, the *Sites* tab lists each site with its version, and marks sites behind the latest release.
- On an **app**, the *Releases* tab shows which versions the app's sites run and how many are outdated.

Through the API: `GET /api/v1/licenses/{id}/activations` returns each site's `version`, and `GET /api/v1/apps/{app}/versions` returns the distribution:

```json
{
  "latest_version": "1.4.0",
  "sites": 12,
  "outdated": 3,
  "data": [
    { "version": "1.4.0", "sites": 9, "outdated": false },
    { "version": "1.3.0", "sites": 3, "outdated": true }
  ]
}
```

## Publishing a release

**Dashboard:** open the app (or the licence), *Releases* tab, *Upload*. Choose the file, enter the version, pick the channel, write the release notes and choose the statuses it is available in. The list shows releases by version, newest first, with the current latest marked; use the menu of a release to edit it, copy its checksum, withdraw or restore it, or delete it.

**API:**

```bash
curl -X PUT "https://<worker>/api/v1/apps/harbor-theme/files?name=harbor-theme-1.4.0.zip&version=1.4.0&changelog=Faster%20gallery." \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/zip" --data-binary @harbor-theme-1.4.0.zip

# longer release notes, or a correction, afterwards
curl -X PATCH https://<worker>/api/v1/apps/harbor-theme/files/<file id> \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"changelog":"Faster gallery.\nFixes the mobile menu."}'

# pull a bad build, and put it back later
curl -X PATCH https://<worker>/api/v1/apps/harbor-theme/files/<file id> -H "Authorization: Bearer $WARDEN_KEY" -d '{"withdrawn":true}'
curl -X PATCH https://<worker>/api/v1/apps/harbor-theme/files/<file id> -H "Authorization: Bearer $WARDEN_KEY" -d '{"withdrawn":false}'
```

Run it from your build pipeline to publish every release automatically.

**From a repository:** connect a GitHub repository to the app or licence, and every version tag you push is published as a release, with a fixed folder name inside the zip. See [repositories.md](repositories.md).

## Example: an updater in WordPress

```php
function harbor_check_for_update( $key, $installed_version ) {
    $url = 'https://your-worker.example/check/' . $key . '?domain=' . rawurlencode( wp_parse_url( home_url(), PHP_URL_HOST ) ) . '&version=' . rawurlencode( $installed_version );
    $res = wp_remote_get( $url, [ 'timeout' => 10 ] );
    if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) >= 500 ) { return null; } // keep the last known state
    $body = wp_remote_retrieve_body( $res );
    if ( ! hash_equals( hash_hmac( 'sha256', $body, $key ), (string) wp_remote_retrieve_header( $res, 'x-warden-signature' ) ) ) { return null; }
    $result = json_decode( $body, true );
    return ! empty( $result['update']['available'] ) ? $result['update']['latest'] : null;
}

// After downloading the package with download_url( $latest['download_url'] ), verify it before installing:
// hash_equals( $latest['sha256'], hash_file( 'sha256', $package ) )
```

Hook the result into the `pre_set_site_transient_update_themes` (or `_plugins`) filter to show the update in the WordPress admin, and install with the regular upgrader.

## Good practice

- Upload each build with its version, and keep older releases: a licence that is not allowed the newest one (for example a release published only for Completed licences) is offered the newest one it is allowed.
- Use the beta channel for early builds and promote a build by changing its channel to stable.
- Withdraw instead of deleting when a release turns out to be broken: sites stop being offered it, and you keep its record and download count.
- Have the site verify the signature of the check and the checksum of the package before installing anything.
