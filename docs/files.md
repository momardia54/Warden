# Files

Files can belong to a single licence, or to an **app** and be shared by every licence of that app ([apps.md](apps.md)). Each file has a **release rule**: the licence statuses in which it can be downloaded. Files are stored privately in R2 and served by the Worker only when the rule is met.

![Editing a release: version, channel, release notes and track](screenshots/edit-file.jpg)

A file with a **version** is a release: it is offered to sites as an update, with a channel, release notes and a checksum. See [releases.md](releases.md). A file without a version is an attachment.

## Release rule

A **release** (a file with a version) takes its release rule from its **track** ([releases.md](releases.md#tracks)): change the track's statuses and all its releases follow. An **attachment** (a file without a version, such as a manual or a notice) has a release rule of its own, described here.

| Setting | Meaning |
|---|---|
| **Available when licence status is** | One or more statuses of the licence's status set ([statuses.md](statuses.md)). The file can be downloaded only while the licence's current status is one of them. Default: the statuses that let sites run (by default Active and Completed). |
| **Require a matching domain** | When on (default), the request must include a `?domain=` that the licence allows: it must match the licence's allowed domains and, if the licence has a site limit, fit within it. Turn it off for files someone downloads by hand. |

The current status takes the status's expiry rule into account: with the default statuses, an Active licence past its expiry date counts as Expired, and a Completed licence never expires. Release rules refer to status keys, so they follow the licence if you rename a status's label, and are updated if you delete a status.

Typical rules:

| Purpose | Statuses | Domain check |
|---|---|---|
| Updates for a licensed site | active, completed | on |
| Final release after full payment | completed | off |
| Maintenance or renewal notice | suspended (and/or expired) | off |

## Endpoints

```
GET /download/<licence key>[?domain=example.com][&channel=beta]
GET /download/<licence key>/<file id>[?domain=example.com]
```

The first returns the licence status and the files visible to the licence (its own files and its app's files), each with `source` (`licence` or `app`), `statuses`, `check_domain` and `available`. Withdrawn releases are not listed, and internal notes are never included. `latest` is the newest release among the available ones in the stable channel (both channels with `channel=beta`). To offer updates, the check endpoint with `?version=` is simpler ([releases.md](releases.md)):

```json
{
  "valid": true,
  "status": "active",
  "message": "",
  "app": { "slug": "harbor-theme", "name": "Harbor Theme" },
  "license_key": "WRD-7KQ4M-X2PHR-9TCVN-B3WZD",
  "checked_at": "2026-10-11T09:12:44.512Z",
  "latest": { "id": "fil_...", "name": "harbor-theme-1.4.0.zip", "version": "1.4.0", "channel": "stable", "changelog": "Faster gallery.", "size": 3000000, "sha256": "9f86d0...", "signature": "base64...", "released_at": "...", "download_url": "https://<worker>/download/WRD-.../fil_..." },
  "files": [
    { "id": "fil_...", "name": "harbor-theme-1.4.0.zip", "version": "1.4.0", "channel": "stable", "changelog": "Faster gallery.", "size": 3000000, "sha256": "9f86d0...", "signature": "base64...", "source": "app", "uploaded_at": "...", "statuses": ["active", "completed"], "check_domain": true, "available": true, "download_url": "https://<worker>/download/WRD-.../fil_..." }
  ]
}
```

Both JSON answers are signed like a check response (`X-Warden-Signature-Ed25519`, see [checking.md](checking.md#verifying-the-signature)), and `signature` on each release is the signature of its `sha256` ([releases.md](releases.md#verifying-a-package)).

The second returns the file as an attachment (with its SHA-256 in the `X-Warden-Sha256` header and the signature of that checksum in `X-Warden-Release-Signature`), or HTTP 403 with `{ valid, status, message, file }` when the rule is not met, 410 for a withdrawn release, or 404 for an unknown key or file. Downloads and denied downloads are written to the licence's activity log.

## Managing files

**Dashboard:** open a licence or an app, *Releases* tab, *Upload*. Choose a file, optionally a version (which makes it a release), select the statuses, then *Upload*. Each file shows whether it is available now, its release rule and its download count. Its menu edits the rule, copies the download link or the checksum, withdraws a release, or deletes the file.

**API:** see [api.md](api.md#files). Upload is a `PUT` with the raw file as the body:

```bash
curl -X PUT "https://<worker>/api/v1/licenses/<id or key>/files?name=harbor-theme.zip&statuses=active,completed&version=1.4.0" \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/zip" --data-binary @harbor-theme.zip
```

Maximum file size is 100 MB (the Worker request body limit on the Free plan). Deleting a licence deletes its files.

## Example: a project paid in instalments

1. Deliver the theme with the licence check built in ([checking.md](checking.md)). Upload each new build as a file released in **Active, Completed** so the site can fetch updates while the licence is valid.
2. Build the final theme without the licence check and upload it released in **Completed** only, with the domain check off. It stays unavailable.
3. When the last payment arrives, set the licence status to **Completed** (dashboard, or `POST /api/v1/licenses/{id}/status`, for example from a payment webhook). The final file becomes available and the licence stays valid indefinitely.
4. Send the client the download link. Once the final theme is installed, the site no longer calls Warden.

## Example: fetching an update from the list (WordPress)

The check endpoint with `?version=` does this in one request ([releases.md](releases.md)). Reading the list works too:

```php
$base = "https://your-worker.example/download/$key";
$res  = wp_remote_get( "$base?domain=" . rawurlencode( $domain ), [ 'timeout' => 10 ] );
if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) !== 200 ) { return; } // keep the current version
$list = json_decode( wp_remote_retrieve_body( $res ), true );
foreach ( $list['files'] as $file ) {
    if ( $file['available'] && version_compare( $file['version'], $installed_version, '>' ) ) {
        $package = download_url( $file['download_url'] . '?domain=' . rawurlencode( $domain ) );
        // install with the regular upgrader
        break;
    }
}
```

Run it on the same schedule as the licence check, and never change anything because of a failed request.

## Limits

- A downloaded copy cannot be recalled, and a file that has been released cannot be taken back.
- No download limits yet (see [Roadmap.md](../Roadmap.md)).
