# Statuses

Every licence has a **status**. The status decides what a site is told when it checks the licence, and which files it can download. Warden starts with a built-in set of statuses, and you can customise them **for an app** and **for a single licence**: rename them, change what they mean, remove the ones you do not need and add your own.

## Where statuses come from

A licence uses, in this order:

1. **its own statuses**, if you customised them on the licence
2. **its app's statuses**, if the licence belongs to an app and you customised the app's statuses
3. **the default statuses**, the built-in set below

Nothing is shared globally: customising an app affects only that app's licences, and customising a licence affects only that licence. A new app or licence needs no setup; it uses the default statuses until you customise them.

| Level | Where to edit | Applies to |
|---|---|---|
| Licence | The licence page, **Statuses** | That licence only. Takes priority over its app |
| App | The app page, **Statuses** | Every licence of the app that has no statuses of its own, the app's default status and its files |
| Default | Built in, not editable | Everything that is not customised |

You can customise statuses **when you create** an app or a licence: the form has a Statuses section with **Customise statuses for this app (or licence)**. You edit the copy in the form, nothing is saved until you submit, and the statuses are stored together with the new app or licence. The default status of the app, or the status of the licence, can already be one of the new statuses.

**Customise statuses** on an existing app or licence page gives it a copy of the statuses it uses now (the app's for a licence, the defaults for an app), which you then edit freely. **Use the inherited statuses again** removes the customisation and goes back to the next level up.

## The default statuses

| Status | Sites can run | Expiry date | Meaning |
|---|---|---|---|
| Pending | No | Does not apply | Created but not in effect yet, for example before the first payment |
| Active | Yes | Becomes Expired | In effect. This is the default for new licences |
| Completed | Yes | Does not apply | Paid in full. Permanent |
| Suspended | No | Does not apply | Temporarily on hold, for example for a late payment |
| Disabled | No | Does not apply | Permanently switched off |
| Expired | No | Does not apply | Past its expiry date. Applied automatically |

Once customised, these are ordinary statuses: you can delete any of them, including Expired, as long as the set keeps at least one status and one default.

## What a status contains

| Field | Meaning |
|---|---|
| **Label** | The name shown in the dashboard, up to 40 characters |
| **Identifier** (`key`) | Stored on licences and used in the API. Lowercase letters, digits and underscores, starting with a letter, up to 32 characters. Generated from the label. **It cannot be changed after the status is created**; rename the label instead. `unknown`, `domain_mismatch` and `site_limit_reached` are reserved for check results |
| **Description** | Explains the status to you. Shown in the status menu |
| **Colour** (`color`) | The badge colour, any hex colour such as `#16a34a`. The editor offers a colour picker and presets for green, teal, blue, purple, pink, amber, red and grey |
| **Sites can run under this status** (`grants_access`) | When on, the check response says `valid: true`. When off, sites are told the licence is not valid and decide what to do |
| **When the expiry date passes** (`on_expiry`) | The status a licence takes on, as seen by sites, once its expiry date has passed. Active becomes Expired by default. Choose "Nothing" for statuses the expiry date should not affect, such as a paid-in-full status |
| **Message to sites** (`check_message`) | Returned in the check response when the licence has no public message of its own |
| **Default for new licences** | New licences start with this status. Exactly one per set |

The licence keeps its stored status; the expiry rule is applied when the licence is read. A licence stored as Active with a past expiry date is reported to sites as Expired, shown as Expired in the dashboard, and extending its expiry date makes it Active again without any change to the stored status.

## Editing

In the editor you can reorder statuses (the order is the order of menus), edit, delete and add. Each row shows what the status does and how many licences use it.

**Deleting a status that licences use** requires choosing the status they move to. File release rules that name the deleted status are updated to the replacement (or removed), an app whose default status was the deleted one switches to the replacement, and expiry rules that pointed to it are cleared. A set cannot be emptied, and one status is always the default.

**Using the inherited statuses again** moves licences to the status with the same identifier in the inherited set. Licences on a status the inherited set lacks need a replacement, which you choose before removing the customisation.

Things that follow from the order of precedence:

- An app's customisation does not touch licences that have statuses of their own.
- Moving a licence to another app changes the app it inherits from. If its status does not exist in the new app's statuses, it takes that set's default status (or the status you send). A licence with its own statuses keeps them.
- A file shared by an app is released using the app's statuses, by identifier. For a licence with its own statuses, it is available when the licence's current status has an identifier the file's rule lists.

## In the check response

```json
{ "name": "Harbor Studio website", "valid": true, "status": "free_trial", "message": "", "expires_at": "2026-10-19T01:04:55.000Z" }
```

`message` is the licence's public message, or the status's message to sites. Besides the status keys of the licence's statuses, `status` can be `domain_mismatch`, `site_limit_reached` or `unknown` (see [checking.md](checking.md)). Sites should decide by `valid`, and show `message` to the owner. Matching on specific status keys is possible, but the keys are yours to define.

## API

| Request | Permission | |
|---|---|---|
| `GET /statuses` | read | The built-in default statuses (read only) |
| `GET /apps/{app}/statuses` | read | The statuses that apply to the app. `custom` is true when it has its own |
| `GET /licenses/{id}/statuses` | read | The statuses that apply to the licence. `source` is `licence`, `app` or `default` |
| `POST .../statuses/customize` | manage | Give the app or licence its own copy of the statuses it uses now |
| `POST .../statuses` | manage | Add a status (after customising) |
| `PATCH .../statuses/{key}` | manage | Change a status (not its key) |
| `DELETE .../statuses/{key}?move_to=` | full | Delete a status. `move_to` is required when licences use it |
| `POST .../statuses/order` | manage | Reorder: `{ "keys": ["pending", "active", ...] }` listing every status |
| `DELETE .../statuses` | full | Use the inherited statuses again. Body `{ "mapping": { "trial": "active" } }` for statuses the inherited set lacks |

`...` is `/apps/{app}` or `/licenses/{id}`. A status as JSON:

```json
{ "key": "free_trial", "label": "Free trial", "description": "14-day trial before purchase.", "color": "#0284c7", "grants_access": true, "on_expiry": "expired", "check_message": "Your trial has ended.", "is_default": false }
```

```bash
curl -X POST https://<worker>/api/v1/apps/harbor-theme/statuses/customize -H "Authorization: Bearer $WARDEN_KEY"
curl -X POST https://<worker>/api/v1/apps/harbor-theme/statuses \
  -H "Authorization: Bearer $WARDEN_KEY" -H "Content-Type: application/json" \
  -d '{"label":"Free trial","color":"#0284c7","grants_access":true,"on_expiry":"expired","check_message":"Your trial has ended."}'
```

Anywhere the API takes a status (`status` on a licence, `statuses` on a file, `default_status` on an app), it is a key of the statuses that apply there. An unknown key returns `422` and lists the valid ones.
