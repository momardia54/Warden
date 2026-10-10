# Analytics

The **Analytics** page shows the licence traffic of the installation: the checks your customers' sites make and the downloads of your files, per day. It answers questions such as:

- Are sites still checking in, or did checks drop (sites offline, the check removed from their code)?
- How many checks are refused, and why: a suspended or expired licence, a domain that is not allowed, a full site limit?
- How many sites are active, and how many are new?
- Which licences generate the most checks, and which files are downloaded?

It is not visitor analytics for your customers' websites: Warden only sees the calls to its check and download URLs.

## On the page

| Part | What it shows |
|---|---|
| Period and app | 7, 30 or 90 days, ending today; every licence, the licences of one app, or the standalone licences. Both are kept in the address, so a view can be bookmarked |
| Checks | Every call of a check URL in the period, and the share answered as valid |
| Refused checks | Checks answered as not valid |
| Active sites | Distinct sites (a licence on a domain) that checked in during the period, and how many registered for the first time |
| Downloads | Files downloaded through download links, and requests refused because the licence's status does not release the file |
| Checks per day | Valid and refused checks, stacked |
| Active sites per day, downloads per day | One column per day |
| Why checks were refused | Refused checks by reason: the status reported (for example *Suspended* or *Expired*), *Wrong domain* or *Site limit reached* |
| Most checked licences | The eight licences with the most checks, with their refused checks |
| Most downloaded files | The eight files downloaded most often |

Hover a day (or focus a chart and use the arrow keys) to read its values. **Table** switches any chart to a table of every day.

The overview shows the checks of the last 30 days across all licences, and each licence shows its own on its **Activity** tab. An app's menu links to the page filtered on that app.

## How the figures are computed

- Days are calendar days in UTC.
- A check is **valid** if the status recorded with it lets sites run, read against the licence's statuses as they are today. If you later change whether a status lets sites run, its past checks are counted the new way.
- A site refused for its domain or for the site limit is not registered, so it does not count as an active site.
- Checks are deleted after 90 days by the daily scheduled job, which is why no period goes further back. Downloads and changes are kept.
- Nothing is pre-aggregated: the figures are read from the activity log each time a page is opened. D1 bills rows read. A site checking about twice a day adds about 60 check rows per 30 days. The overview chart reads those rows once (300 sites: about 18,000 rows per load). The Analytics page reads them about four times (300 sites over 90 days: about 220,000 rows). The D1 free plan allows 5 million rows read per day.

## API

`GET /api/v1/analytics` returns the same report (scope `read`):

| Parameter | Values |
|---|---|
| `days` | `7`, `30` (default) or `90` |
| `app` | An app id or slug, or `none` for standalone licences |
| `license` | A licence id or key (takes precedence over `app`) |

```json
{
  "days": 30,
  "from": 1757548800000,
  "to": 1760097600000,
  "series": [{ "date": "2026-09-11", "valid": 18, "refused": 0, "sites": 8, "downloads": 0 }],
  "totals": { "checks": 742, "valid": 683, "refused": 59, "sites": 10, "new_sites": 10, "downloads": 23, "refused_downloads": 1 },
  "refusals": [{ "key": "suspended", "label": "Suspended", "checks": 25 }],
  "licenses": [{ "id": "lic_...", "name": "Harbor Studio website", "app_name": "Harbor Theme", "checks": 213, "refused": 3, "last_check_at": 1760090000000 }],
  "files": [{ "name": "harbor-theme-1.4.0.zip", "downloads": 15 }]
}
```
