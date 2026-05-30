# POTACAT data files

Static datasets that POTACAT desktop / workers can consume. None of this
is scraped from third-party sites — every entry is sourced from the
sponsor's own publication of names, URLs, and date formulas.

## `contests.json`

Curated database of recurring amateur radio contests. Seeded 2026-05-30
with 71 entries spanning worldwide DX, North American QSO parties,
weekly CW sprints, VHF/UHF, digital, and topband specials.

Each contest has:

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case stable identifier (`cq-ww-ssb`) |
| `name` | yes | Human-readable name (e.g. "CQ WW DX Contest, SSB") |
| `sponsor` | yes | Sponsoring org |
| `website` | yes | Sponsor's official site |
| `rulesUrl` | yes | Direct link to the rules. Often same as website. |
| `whenRule` | yes | Plain-English cadence (e.g. "Last full weekend of October") |
| `whenComputed` | yes | Parser-friendly cadence — see schema below |
| `durationHours` | yes | Contest length. May be smaller than the window if max-op limits apply (note in `notes`). |
| `bands` | yes | List of band labels ("160m", "80m", … "all HF", "VHF") |
| `modes` | yes | `["CW"]`, `["SSB"]`, `["RTTY"]`, `["FT8","FT4"]`, `["any"]`, etc. |
| `category` | yes | `worldwide-dx`, `north-american`, `state-qso-party`, `single-band`, `vhf-uhf`, `digital`, `weekly-sprint`, `monthly-qrp`, `monthly`, `newcomer`, `operating-event`, `regional`, `pota-sota` |
| `notes` | optional | Short freeform notes (exchange format quirks, power limits, etc.) |

### `whenComputed` syntax

A small DSL so a date-parser can compute the actual date for any year:

| Pattern | Example | Meaning |
|---|---|---|
| `nth-weekend-of:<MM>:<n>` | `nth-weekend-of:10:-1` | Last full weekend of October. `n=1..4` for first..fourth, `-1` for last. |
| `nth-weekday-of:<MM>:<n>:<day>` | `nth-weekday-of:4:3:Sun` | Third Sunday of April. day = `Mon|Tue|Wed|Thu|Fri|Sat|Sun`. `n=-1` for last. |
| `fixed:<MM-DD>` | `fixed:01-01` | Fixed calendar date every year. |
| `weekly:<day>:<HHMM>z` | `weekly:Wed:1300z` | Recurring weekly. |
| `monthly-first-weekend` | — | First full Sat+Sun weekend of every month (POTA Plaque pattern). |
| `monthly-nth:<n>:<day>` | `monthly-nth:3:Sun` | Third Sunday of every month. |
| `range:<MM-DD>:<MM-DD>` | `range:07-01:07-07` | Fixed calendar date range each year (13 Colonies, YOTA Month). |
| `custom:<text>` | `custom:see SOTA reflector` | Fallback when no formula applies. |

### Adding entries

Two rules to keep this maintainable:

1. **Only public facts.** Sponsor's own site + sponsor's own date rule.
   Contest names, sponsor URLs, and date formulas published by the
   sponsor are first-principles ham-radio public information — not
   copied from any third-party index.
2. **Verify the URL responds 2xx or 3xx.** A few major sponsors return
   406 to default curl UAs; those entries are kept (the URL is correct,
   the site just blocks bot UAs). Outright DNS failures or 404s mean
   the URL is wrong — fix or drop the entry.

### Out of scope (for now)

Contest scoring rules, log-submission deadlines, multi-year exception
dates (e.g. when a major contest moves a week to dodge a religious
holiday), and per-year overrides. Those belong in an "exceptions" file
keyed by contest id + year.

### Future: worker integration

The intended consumer is a follow-on `worker/contests/` Cloudflare
Worker (same pattern as `worker/dxpeditions/`). The worker would:

1. Bundle this JSON as its primary source.
2. Optionally cross-reference live sponsor iCal feeds (ARRL's, IARU's,
   DX Engineering's community iCal) to catch year-specific overrides.
3. Serve a normalized JSON at `contests.potacat.com/feeds/contests.json`
   that desktop pulls on a 12-24h cadence.

Until that worker exists, the desktop can read this file directly via
`require('./data/contests.json')`.
