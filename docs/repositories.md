# Publishing releases from a repository

An app or a licence can be connected to a GitHub repository. Connect GitHub once under **Integrations**, then pick a repository from a list. When you push a version tag, Warden downloads the repository at that tag as a zip, renames its top-level folder and publishes it as a release, exactly as if you had uploaded the file yourself. Sites that check with their version are then offered the update.

Nothing is built: the repository is published as it is. This suits themes and plugins whose repository is the package. A project that needs a build step can upload its build with the API from its pipeline instead (see [releases.md](releases.md)).

## Connecting GitHub (once)

Open **Integrations**, GitHub, **Create GitHub App**. Warden creates a GitHub App of its own through GitHub's app manifest flow:

1. GitHub shows the app Warden asks for, owned by your personal account or an organisation. It can read repository contents and metadata and receives push events, nothing else. You can change its name before confirming; names are unique across GitHub.
2. GitHub returns the app's credentials to Warden, and opens the installation page: install the app on the account or organisation that owns your repositories, for all repositories or selected ones.
3. Back on Integrations, Warden lists the installations. *Install on another account* adds one; *Configure on GitHub* changes which repositories an installation covers.

The app's webhook points at `https://<your-worker>/hooks/github-app`, one address for every repository, and is signed with a secret GitHub generated for the app. Nothing has to be copied by hand. Warden must be reachable at its public address for the app's webhook; GitHub does not deliver to `localhost`.

The app's private key and webhook secret are stored in your D1 database. Warden uses the key to request access tokens that last one hour and only read repository contents. *Remove from Warden* forgets the credentials (refused while repositories still use the app); delete the app on GitHub as well, under the app's settings, *Advanced*.

## Connecting a repository

Open the app (or the licence), *Releases* tab, *Connect repository*.

| Field | Meaning |
|---|---|
| Repository | Picked from the repositories the GitHub App can access, private ones included. A repository missing from the list is added to the installation on GitHub. |
| Trigger | *New tag*: pushing a tag publishes a release (see below). Other triggers can be added later. |
| Package folder | The top-level folder inside the published zip, for example `harbor-theme`. Defaults to the repository name. |
| Available when licence status is | The release rule of each published release, as for an upload. Each release can be changed afterwards. |
| Only for allowed sites | The domain check of each published release, as for an upload. |

Warden checks that it can read the repository before saving. A repository is matched by its id, so renaming it on GitHub does not break the connection; Warden shows the new name after the next tag.

### Without the GitHub App: an access token and a webhook

*Connect with an access token and a webhook instead* (or the only option before GitHub is connected) works without installing an app, for one repository at a time:

| Field | Meaning |
|---|---|
| Repository | `owner/repository`, or its github.com address. |
| Access token | Only for a private repository: a fine-grained personal access token limited to that repository, with read-only access to *Contents*. Stored in your D1 database and never shown again. |

After connecting, Warden shows the values to enter in GitHub, under the repository's *Settings, Webhooks, Add webhook*:

- **Payload URL**: `https://<your-worker>/hooks/github/<source id>`
- **Content type**: `application/json`
- **Secret**: the secret Warden shows
- **Which events**: *Just the push event*

GitHub sends a test delivery when the webhook is created; the section then shows the time of the last delivery. Every delivery is signed with the secret (`X-Hub-Signature-256`), and Warden rejects deliveries with a wrong signature. *Generate a new secret* (in *Webhook setup*) replaces it; update it in GitHub afterwards.

## What a tag publishes

| Tag | Result |
|---|---|
| `v1.4.0` or `1.4.0` | Version `1.4.0` on the stable channel, file `<package folder>-1.4.0.zip` |
| `v2.0.0-beta.1` | Version `2.0.0-beta.1` on the beta channel |
| `nightly`, or any tag that is not a version | Skipped |
| A version that is already published (and not withdrawn) | Skipped; withdraw or delete that release, then retry |
| A branch push | Nothing |

The internal notes of each published release record the repository, the tag and the commit.

**The package folder.** GitHub wraps the archive in a folder named after the commit, such as `harbor-studio-harbor-theme-3f2a9c1/`. WordPress installs a theme or plugin into the folder found in the zip, so that name would change with every release. Warden renames it to the package folder, so every release installs into the same place. Only the zip's headers are rewritten; the files are copied unchanged, and the archive comment (GitHub stores the commit there) is kept.

To leave files out of the package, such as tests or development configuration, mark them `export-ignore` in the repository's `.gitattributes`; GitHub leaves them out of the archive:

```
/tests          export-ignore
/.github        export-ignore
phpunit.xml     export-ignore
```

## Recent tags

The section lists the latest tags with their state: *In progress*, *Published*, *Skipped* or *Failed*, with the reason. *Retry* runs a failed or skipped tag again. GitHub may deliver the same webhook more than once; a tag is published only once.

*Publish a tag* publishes an existing tag by hand, for example one pushed before the webhook was added.

*Pause publishing* keeps the connection but ignores new tags; *Disconnect repository* removes it. Releases already published stay in both cases. For a repository connected with a token, remove its webhook in GitHub after disconnecting.

## Limits

- Packages are limited to 100 MB, like uploads.
- Publishing runs in the background after the webhook is answered. An import that does not finish within 15 minutes is reported as failed and can be retried.
- A repository connected with neither the GitHub App nor an access token is read anonymously: GitHub allows 60 API requests per hour from the Worker's address. Publishing a tag uses one or two.

## API

| Method and path | Scope | Description |
|---|---|---|
| `GET /apps/{app}/source` | read | The connected repository. `webhook_secret` is returned to keys with `manage` or `full` only; the access token is never returned (`has_token`) |
| `PUT /apps/{app}/source` | manage | Connect or edit: `connection` (`app` or `token`; a new source uses `app` when the GitHub App is connected and no token is sent), `provider`, `repository`, `trigger`, `package_folder`, `statuses`, `check_domain`, `token` (`""` removes it), `enabled`. Fields left out keep their value |
| `DELETE /apps/{app}/source` | manage | Disconnect |
| `POST /apps/{app}/source/regenerate-secret` | manage | Replace the webhook secret |
| `GET /apps/{app}/source/imports` | read | Latest tags and their state |
| `POST /apps/{app}/source/imports` | manage | Publish a tag: `{ "tag": "v1.4.0" }` |
| `POST /apps/{app}/source/imports/{id}/retry` | manage | Retry a failed or skipped tag |

The same endpoints exist under `/licenses/{id}/source`.

| Method and path | Scope | Description |
|---|---|---|
| `GET /integrations/github` | read | `{ connected, app, installations }`: the app's name, owner and address, and each installation's account and repository selection. Never the app's key or secrets |
| `GET /integrations/github/repositories` | read | The repositories the app can access: `{ id, full_name, private, account }` |

The GitHub App itself is created in the dashboard, because GitHub's confirmation happens in the browser.

```bash
curl -X PUT https://<worker>/api/v1/apps/harbor-theme/source \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"repository":"harbor-studio/harbor-theme","package_folder":"harbor-theme"}'
```
