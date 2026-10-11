# Statuses

Every licence has a **status**. The status decides what a site is told when it checks the licence, and which files it can download. Warden starts with a built-in set of statuses, and you can customise them **for an app** or **for a standalone licence**: rename them, change what they mean, remove the ones you do not need and add your own.

![An app with its own statuses](screenshots/app-statuses.jpg)

## Where statuses come from

| The licence is | It uses |
|---|---|
| in an app | the app's statuses, or the built-in defaults if the app has not customised them |
| standalone (no app) | its own statuses if you customised them, otherwise the built-in defaults |

A licence that belongs to an app **cannot have statuses of its own**: all licences of an app share the app's statuses, so they are the same everywhere in that product. Change them on the app page.

| Level | Where to edit | Applies to |
|---|---|---|
| App | The app page, **Statuses** | Every licence of the app, the app's default status and its files |
| Standalone licence | The licence page, **Statuses** | That licence only |
| Default | Built in, not editable | Everything that is not customised |

Nothing is shared globally. A new app or licence needs no setup: it uses the default statuses until you customise them.

You can customise statuses **when you create** an app or a standalone licence: the form has a Statuses section with **Customise statuses for this app (or licence)**. You edit a copy of the defaults in the form, nothing is saved until you submit, and the statuses are stored together with the new app or licence. In the licence form the section disappears once you choose an app.

**Customise statuses** on an existing app or standalone licence page gives it a copy of the default statuses, which you then edit freely. **Use the default statuses again** removes the customisation.

## The default statuses

| Status | Valid | Expiry date | Meaning |
|---|---|---|---|
| Pending | No | Does not apply | Issued but not valid yet, for example until the first payment |
| Active | Yes | Becomes Expired | Valid. The default for new licences |
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
| **Valid status** (`grants_access`) | When on, checks return `valid: true`. When off, checks return `valid: false` and the site applies its own handling |
| **When the expiry date passes** (`on_expiry`) | The status a licence takes on, as seen by sites, once its expiry date has passed. Active becomes Expired by default. Choose "Nothing" for statuses the expiry date should not affect, such as a paid-in-full status |
| **Message to sites** (`check_message`) | Returned in the check response when the licence has no public message of its own |
| **Default for new licences** | New licences start with this status. Exactly one per set |

The licence keeps its stored status; the expiry rule is applied when the licence is read. A licence stored as Active with a past expiry date is reported to sites as Expired, shown as Expired in the dashboard, and extending its expiry date makes it Active again without any change to the stored status.

## Grace period

A grace period keeps a licence valid for some days after its expiry date, so a renewal paid a little late does not interrupt the customer's site. During the grace period:

- the expiry rule waits: the check reports the stored status (Active) with `valid: true`;
- the check response carries `grace_ends_at`, the end of the grace period, and, when the licence has no public message of its own, a reminder in `message`: "This licence expired on 2026-10-09. It remains valid until 2026-10-16; renew it to keep using it.";
- the dashboard shows the licence as expiring, with the end of its grace period, and lists it in the *Expiring* view;
- downloads and update offers work as for any valid licence.

When the grace period ends, the expiry rule applies (Active becomes Expired). Statuses without an expiry rule, such as Completed, are not affected.

The grace period is set on an app, for all of its licences, and can be set on a licence to override its app's (0 for none). A standalone licence has none unless it sets one. Up to 365 days. Through the API: `grace_days` on apps and licences; licences also return `effective_grace_days` (the setting in effect) and `grace_ends_at`.

Renewing a licence during its grace period extends it from its expiry date, not from the day of the renewal: the grace days already used are not given again. A licence whose grace period has ended is extended from the day of the renewal, as before.

Outgoing webhooks report the start of a grace period (`license.grace_period_started`) and the expiry once it has ended (`license.expired`); see [webhooks.md](webhooks.md).

## Editing

In the editor you can reorder statuses (the order is the order of menus), edit, delete and add. Each row shows what the status does and how many licences use it.

**Deleting a status that licences use** requires choosing the status they move to. File release rules that name the deleted status are updated to the replacement (or removed), an app whose default status was the deleted one switches to the replacement, and expiry rules that pointed to it are cleared. A set cannot be emptied, and one status is always the default.

**Using the default statuses again** moves licences to the status with the same identifier in the default set. Licences on a status the default set lacks need a replacement, which you choose before removing the customisation.

Things that follow:

- Moving a licence into an app discards the licence's own statuses and uses the app's. If its status does not exist in the app's statuses, it takes the app's default status (or the status you send). Moving it out of an app makes it standalone, using the default statuses.
- A file shared by an app is released using the app's statuses, by identifier.

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
| `GET /licenses/{id}/statuses` | read | The statuses that apply to the licence. `source` is `licence`, `app` or `default`. For a licence in an app this is read only |
| `POST .../statuses/customize` | manage | Give the app or standalone licence its own copy of the default statuses |
| `POST .../statuses` | manage | Add a status (after customising) |
| `PATCH .../statuses/{key}` | manage | Change a status (not its key) |
| `DELETE .../statuses/{key}?move_to=` | full | Delete a status. `move_to` is required when licences use it |
| `POST .../statuses/order` | manage | Reorder: `{ "keys": ["pending", "active", ...] }` listing every status |
| `DELETE .../statuses` | full | Use the default statuses again. Body `{ "mapping": { "trial": "active" } }` for statuses the default set lacks |

`...` is `/apps/{app}` or `/licenses/{id}`. Changing the statuses of a licence that belongs to an app returns `409` (`license_in_app`): change the app's statuses instead. A status as JSON:

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
