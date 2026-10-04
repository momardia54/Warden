# Files

Files can belong to a single licence, or to an **app** and be shared by every licence of that app ([apps.md](apps.md)). Each file has a **release rule**: the licence statuses in which it can be downloaded. Files are stored privately in R2 and served by the Worker only when the rule is met.

## Release rule

| Setting | Meaning |
|---|---|
| **Available when licence status is** | One or more of `pending`, `active`, `completed`, `suspended`, `disabled`, `expired`. The file can be downloaded only while the licence's current status is one of them. Default: `active` and `completed`. |
| **Require a matching domain** | When on (default), the request must include a `?domain=` that the licence allows: it must match the licence's allowed domains and, if the licence has a site limit, fit within it. Turn it off for files someone downloads by hand. |

`expired` is the effective status: an `active` licence past its expiry date counts as `expired`. A `completed` licence is permanent and never expires.

Typical rules:

| Purpose | Statuses | Domain check |
|---|---|---|
| Updates for a licensed site | active, completed | on |
| Final release after full payment | completed | off |
| Maintenance or renewal notice | suspended (and/or expired) | off |

## Endpoints

```
GET /download/<licence key>[?domain=example.com]
GET /download/<licence key>/<file id>[?domain=example.com]
```

The first returns the licence status and the files visible to the licence (its own files and its app's files), each with `source` (`licence` or `app`), `statuses`, `check_domain` and `available`. `latest` points to the file with the highest version among the available ones, so a site can look for a newer `version` before downloading:

```json
{
  "valid": true,
  "status": "active",
  "message": "",
  "app": { "slug": "harbor-theme", "name": "Harbor Theme" },
  "latest": { "id": "fil_...", "name": "harbor-theme-1.4.0.zip", "version": "1.4.0", "download_url": "https://<worker>/download/WRD-.../fil_..." },
  "files": [
    { "id": "fil_...", "name": "harbor-theme-1.4.0.zip", "version": "1.4.0", "size": 3000000, "source": "app", "statuses": ["active", "completed"], "check_domain": true, "available": true, "download_url": "https://<worker>/download/WRD-.../fil_..." }
  ]
}
```

The second returns the file as an attachment, or HTTP 403 with `{ valid, status, message, file }` when the rule is not met, or 404 for an unknown key or file. Downloads and refusals are written to the licence's activity log.

## Managing files

**Dashboard:** open a licence, *Files*. Choose a file, optionally a version, select the statuses, then *Upload*. Each file shows whether it is available now, its release rule and its download count. Use the pencil to change the rule later, the copy button for the download link, and the bin to delete.

**API:** see [api.md](api.md#files). Upload is a `PUT` with the raw file as the body:

```bash
curl -X PUT "https://<worker>/api/v1/licenses/<id or key>/files?name=harbor-theme.zip&statuses=active,completed&version=1.4.0" \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/zip" --data-binary @harbor-theme.zip
```

Maximum file size is 100 MB (the Worker request body limit on the Free plan). Deleting a licence deletes its files.

## Example: a project paid in instalments

1. Deliver the theme with the licence check built in ([checking.md](checking.md)). Upload each new build as a file released in **Active, Completed** so the site can fetch updates while the licence is in effect.
2. Build the final theme without the licence check and upload it released in **Completed** only, with the domain check off. It stays unavailable.
3. When the last payment arrives, set the licence status to **Completed** (dashboard, or `POST /api/v1/licenses/{id}/status`, for example from a payment webhook). The final file becomes available and the licence stays valid indefinitely.
4. Send the client the download link. Once the final theme is installed, the site no longer calls Warden.

## Example: fetching an update (WordPress)

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
- No download limits and no checksums yet (see [Roadmap.md](../Roadmap.md)).
