# Files: updates and the final hand-over

Each licence can carry files, stored privately in R2. Warden hands a file out only when the licence allows it.

| Kind | Downloadable when | Domain checked |
|---|---|---|
| **update** | status `active` or `completed`, and the end date has not passed (`completed` ignores it) | yes, if the licence lists domains |
| **final** | status `completed` (paid in full) | no |

A `pending`, `suspended`, `disabled` or `expired` licence downloads nothing. Refusals are HTTP 403 with a JSON body (`valid`, `status`, `message`) so a site can show the message.

## Download URLs

```
GET /download/<licence key>                      → { valid, status, message, files: [ { id, name, kind, version, notes, size, uploaded_at, available, download_url } ] }
GET /download/<licence key>/<file id>?domain=…   → the file (Content-Disposition: attachment), or 403 JSON, or 404 (unknown key or file)
```

The listing is the "is there an update?" call: compare `version` with the installed one, then download the newest `available` file of kind `update`. Send `domain` on both calls.

## Workflow: a project paid in instalments

1. **Build the licence-aware theme** (it calls the check URL, see [checking.md](checking.md)) and deliver it to the client as usual. Upload later versions as **update** files so the site can pull them while the licence is in force.
2. **Build the final theme**: the same theme with the licence check removed (and anything else that only exists for the instalment period). Upload it as a **final** file. It stays locked.
3. When the last payment arrives, set the licence to **completed** (dashboard: *Change status*, or `POST /api/v1/licenses/{id}/status` with `{"status":"completed"}`, for example from your payment webhook).
4. The final file unlocks. Give the client the link (copy it from the licence page) or let the site fetch it. After installing it, the site no longer needs Warden.

A completed licence keeps answering `valid: true` to the check URL, so a site that still has the old check keeps working until the final build is installed.

## From the site: pulling an update (WordPress sketch)

```php
$base = "https://your-worker.example/download/$key";
$res  = wp_remote_get( "$base?domain=" . rawurlencode( $domain ), [ 'timeout' => 10 ] );
if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) !== 200 ) { return; }   // keep what you have
$list = json_decode( wp_remote_retrieve_body( $res ), true );
foreach ( $list['files'] as $f ) {
    if ( $f['kind'] === 'update' && $f['available'] && version_compare( $f['version'], $installed, '>' ) ) {
        $zip = download_url( $f['download_url'] . '?domain=' . rawurlencode( $domain ) );   // then install it with the usual upgrader
        break;
    }
}
```

Run it on the same schedule as the licence check (about every 12 hours), and never let a failed request change anything.

## Managing files

- **Dashboard:** licence page, *Files*: choose a file, a kind and an optional version, *Upload*. Each row shows whether it is available right now, its download count, a copy-link button and delete.
- **API:** `PUT /api/v1/licenses/{id}/files?name=…&kind=…&version=…` with the raw file as the body, see [api.md](api.md#files).
- Up to **100 MB** per file (the Worker request limit on the Free plan). Deleting a licence deletes its files; deleting a file removes it from storage at once.
- Files need an R2 bucket (`FILES`). Without one the dashboard says so, and the rest of Warden keeps working.

## Limits

A copy that was downloaded cannot be recalled, and a released final file cannot be taken back. There are no download limits or checksums yet (see [Roadmap.md](../Roadmap.md)).
