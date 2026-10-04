# Apps

An **app** is a product you license to many customers, for example a plugin or a theme. Licences can belong to an app. A licence without an app is a **standalone** licence, for a single customer or a custom project.

| | Standalone licence | Licence under an app |
|---|---|---|
| Starts with | The values you enter | The app's defaults (duration, status, maximum sites, public message) |
| Files | Its own files | Its own files and every file shared by the app |
| Typical use | A custom website built for one client | A product sold to many customers |

## Creating an app

Dashboard: **Apps**, **New app**. API: `POST /api/v1/apps`.

| Field | Meaning |
|---|---|
| Name and identifier | The identifier (slug) is generated from the name and used in the API, for example `harbor-theme` |
| Description | Shown on the app page |
| Default status | The status a new licence starts with. Use Pending to hold licences until payment is confirmed |
| Default duration (days) | A new licence expires this many days after it is issued. Empty: no expiry |
| Default maximum sites | How many sites one licence may be used on. Empty: unlimited |
| Default public message | The message new licences return to sites |

The defaults are a starting point. Every value can be changed on each licence.

## Issuing licences

Dashboard: open the app, **Issue licence**. The form opens with the app's defaults filled in. API: `POST /api/v1/apps/{app}/licenses`, or `POST /api/v1/licenses` with `"app": "harbor-theme"`.

```bash
curl -X POST https://<worker>/api/v1/licenses \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"app":"harbor-theme","name":"Harbor Studio website","customer_name":"Harbor Studio","customer_email":"billing@harborstudio.com","external_ref":"order-1042"}'
```

`external_ref` makes the call idempotent: sending the same reference again returns the first licence. Use your order or invoice number so a retried request or a repeated payment webhook never issues two licences.

Licences can be moved to another app (or made standalone) by editing them, or with `PATCH /api/v1/licenses/{id}` and `{"app": "other-app"}`.

## Sites and the site limit

A licence can limit how many different sites (domains) may use it. Each site registers automatically on its first check:

1. The customer's site checks the licence with its domain: `GET /check/<key>?domain=harborstudio.com`.
2. If the licence has room, the domain is registered and the check succeeds.
3. When the limit is reached, a new domain is refused with `site_limit_reached`. Domains that are already registered keep working.
4. On the licence page, **Release site** frees a slot, for example when the customer moves to a new domain. The old site can register again if there is room.

A licence with a site limit requires the domain in every check (and download). A licence without a limit does not.

This can be combined with **Allowed domains**, a fixed list that restricts a licence to specific domains. Use the list for custom deals, and the site limit for products.

The site limit relies on the domain the site reports, so it is a licensing control, not a technical barrier (see [Security.md](../Security.md)).

## Shared releases

Files uploaded to an app are shared by all of its licences: upload a version once and every customer can download it, subject to each file's release rule (the licence statuses in which it is available, see [files.md](files.md)).

- A licence's download list (`GET /download/<key>`) contains its own files and the app's files, marked with their `source`.
- The `latest` field points to the highest version among the files available to that licence, so a site can check for updates with one request.
- Downloads are counted per file and written to the activity log of the licence that downloaded them.
- A file shared by an app is visible only to licences of that app.

## Deleting

An app can be deleted only when it has no licences, so a licence never loses its app by accident. Delete the licences, or move them to another app, first. Deleting an app also deletes its files. Deleting a licence leaves the app's files untouched.
