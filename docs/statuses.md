# Statuses

Every licence has a **status**. The status decides what a site is told when it checks the licence, and which files it can download. Warden starts with a default set of statuses, and you can rename them, change what they mean, remove the ones you do not need and add your own.

## The default statuses

| Status | Sites can run | Expiry date | Meaning |
|---|---|---|---|
| Pending | No | Does not apply | Created but not in effect yet, for example before the first payment |
| Active | Yes | Becomes Expired | In effect. This is the default for new licences |
| Completed | Yes | Does not apply | Paid in full. Permanent |
| Suspended | No | Does not apply | Temporarily on hold, for example for a late payment |
| Disabled | No | Does not apply | Permanently switched off |
| Expired | No | Does not apply | Past its expiry date. Applied automatically |

These are ordinary statuses. Nothing is built in: you can delete any of them, including Expired, as long as the set keeps at least one status and one default.

## What a status contains

| Field | Meaning |
|---|---|
| **Label** | The name shown in the dashboard, up to 40 characters |
| **Identifier** (`key`) | Stored on licences and used in the API. Lowercase letters, digits and underscores, starting with a letter, up to 32 characters. Generated from the label. **It cannot be changed after the status is created**; rename the label instead. `unknown`, `domain_mismatch` and `site_limit_reached` are reserved for check results |
| **Description** | Explains the status to you. Shown in the status menu |
| **Colour** | The badge colour: green, amber, red, blue or grey |
| **Sites can run under this status** (`grants_access`) | When on, the check response says `valid: true`. When off, sites are told the licence is not valid and decide what to do |
| **When the expiry date passes** (`on_expiry`) | The status a licence takes on, as seen by sites, once its expiry date has passed. Active becomes Expired by default. Choose "Nothing" for statuses the expiry date should not affect, such as a paid-in-full status |
| **Message to sites** (`check_message`) | Returned in the check response when the licence has no public message of its own |
| **Default for new licences** | New licences start with this status. Exactly one per set |

The licence keeps its stored status; the expiry rule is applied when the licence is read. A licence stored as Active with a past expiry date is reported to sites as Expired, shown as Expired in the dashboard, and extending its expiry date makes it Active again without any change to the stored status.

## Editing the default statuses

Dashboard: **Statuses**. Each row shows the status, what it does, and how many licences use it. You can reorder statuses (the order is the order of menus), edit, delete and add.

**Deleting a status that licences use** requires choosing the status they move to. File release rules that name the deleted status are updated to the replacement (or removed), apps whose default status was the deleted one switch to the replacement, and expiry rules that pointed to it are cleared. A set cannot be emptied, and the default status cannot be left unassigned.

## Statuses per app

By default every app uses the default statuses. An app can have **its own set** instead, for example a product with a Trial status that the other products do not need.

- On the app page, **Statuses**, choose **Customise statuses for this app**. The app gets a copy of the default statuses, which you can then edit freely. Changes to the default statuses no longer affect this app.
- Licences of the app, the app's default status, the app's files and their release rules all use the app's set.
- **Use the default statuses again** removes the app's set. Licences move to the default status with the same identifier. For licences on a status that the default set lacks, you choose a replacement first.
- Standalone licences always use the default statuses.
- Moving a licence to another app changes the set it uses. If its status does not exist in the new app's set, it takes that set's default status (or the status you send).

## In the check response

The check response contains the status key and `valid`:

```json
{ "name": "Harbor Studio website", "valid": true, "status": "trial", "message": "", "expires_at": "2026-10-18T21:59:12.000Z" }
```

`message` is the licence's public message, or the status's message to sites. Besides the status keys of the licence's set, `status` can be `domain_mismatch`, `site_limit_reached` or `unknown` (see [checking.md](checking.md)). Sites should decide by `valid`, and show `message` to the owner. Matching on specific status keys is possible, but the keys are yours to define.

## API

| Request | Permission | |
|---|---|---|
| `GET /statuses` | read | The default statuses |
| `POST /statuses` | manage | Add a status |
| `PATCH /statuses/{key}` | manage | Change a status (not its key) |
| `DELETE /statuses/{key}?move_to=` | full | Delete a status. `move_to` is required when licences use it |
| `POST /statuses/order` | manage | Reorder: `{ "keys": ["pending", "active", ...] }` listing every status |
| `GET /apps/{app}/statuses` | read | The statuses that apply to the app, with `custom: true/false` |
| `POST /apps/{app}/statuses/customize` | manage | Give the app its own copy of the default statuses |
| `POST`, `PATCH`, `DELETE` `/apps/{app}/statuses/...` | manage / full | Same as above, for the app's own set |
| `POST /apps/{app}/statuses/order` | manage | Reorder the app's statuses |
| `DELETE /apps/{app}/statuses` | full | Use the default statuses again. Body `{ "mapping": { "trial": "active" } }` for statuses the default set lacks |

A status as JSON:

```json
{ "key": "trial", "label": "Trial", "description": "14-day trial before purchase.", "tone": "info", "grants_access": true, "on_expiry": "expired", "check_message": "Your trial has ended.", "is_default": false }
```

```bash
curl -X POST https://<worker>/api/v1/statuses \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"label":"Grace period","grants_access":true,"tone":"warning","on_expiry":"expired","check_message":"Please renew soon."}'
```

Anywhere the API takes a status (`status` on a licence, `statuses` on a file, `default_status` on an app), it is a key of the status set that applies. An unknown key returns `422` and lists the valid ones.
