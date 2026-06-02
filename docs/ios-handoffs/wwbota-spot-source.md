# WWBOTA (Worldwide Bunkers on the Air) — add as a spot source on iOS / Android

Status: open
Filed: 2026-06-01
For: POTACAT iOS / Android (ECHOCAT)
Reporter: BexiBuxi via GitHub issue [#34](https://github.com/Waffleslop/POTACAT/issues/34)
Repo for changes: `D:\Projects\potacat-app`
Desktop side: shipped — see `lib/wwbota.js`, `main.js` (`processWwbotaSpots`),
`renderer/app.js` (`enableWwbota` + filter wiring), styles, and `CLAUDE.md`.

## Context

WWBOTA is an international "<thing> on the air" award programme for
historical bunkers. National branches — UKBOTA (G), HBBOTA (HB),
USBOTA (US), ITABOTA (IT), FBOTA (F), ONBOTA (ON), etc. — all funnel
through one cluster. References look like `B/G-2392`, `B/HB-3477`,
`B/IT-0024`. Multi-bunker (n-fer) activations from a single QTH are
the norm, not the exception — a single spot routinely lists 5+
bunkers.

The desktop now polls `https://api.wwbota.net/spots/?age=1` on the
normal spot refresh cycle. POTA defaults stay; WWBOTA is **on by
default** (Casey 2026-06-01) — matches POTA, since most chasers will
want bunkers visible without opting in.

## What the desktop already sends

WWBOTA spots flow through the existing `spot-update` channel with
`source: 'wwbota'` and the same shape as POTA/SOTA/WWFF/LLOTA. Extra
fields specific to WWBOTA:

| field                  | type     | example                              |
|------------------------|----------|--------------------------------------|
| `source`               | string   | `"wwbota"`                           |
| `reference`            | string   | `"B/G-2392"` (primary bunker)        |
| `parkName`             | string   | `"RAF Fulbeck Defensive Cluster"`    |
| `wwbotaScheme`         | string   | `"UKBOTA"` (or `HBBOTA`, etc.)       |
| `wwbotaSecondaryRefs`  | string[] | `["B/ON-1049","B/ON-1052","B/ON-1053"]` (empty when single-bunker) |
| `wwbotaRefsLabel`      | string   | `"B/ON-1047 +4 more"` (compact label for an n-fer) |
| `comments`             | string   | `"B/G-2392 [QRT]"` (QRT marker is appended when the API's `type:"QRT"` is set, so the existing "Hide QRT spots" filter catches it) |

`frequency` is the same kHz string the rest of POTACAT uses — WWBOTA's
API serves MHz, the desktop converts on ingest.

The desktop's `set-sources` push now includes:
```js
{ pota, sota, wwff, llota, wwbota, tiles, cluster }
```
and the corresponding `enableWwbota` setting (default `true`) round-trips
through the existing `set-sources` handler — no new protocol verb.

QSO save (`log-qso`) accepts two new optional fields, mirroring
`{wwff,llota}{Respot,Reference}`:

| field              | type    | meaning |
|--------------------|---------|---------|
| `wwbotaRespot`     | boolean | If true, desktop will POST a re-spot to `api.wwbota.net/spots/` after the QSO saves. |
| `wwbotaReference`  | string  | The bunker ref, e.g. `B/G-2392`. Validated against `/^B\/[A-Z0-9]+-\d{1,5}$/i`. |

Re-spot is **unauthenticated** — the WWBOTA API documents
both `GET /spots/` and `POST /spots/` as open (verified
against `https://api.wwbota.net/openapi.json`), so no token/credential
field is needed on the iOS side.

A `wwbotaRef` field also rides along on log payloads (peer of
`potaRef` / `sotaRef` / `wwffRef` / `llotaRef`) so the ADIF gets
`SIG=WWBOTA` + `SIG_INFO=B/G-2392` written correctly.

## What needs to change in the iOS / Android app

Mirror the WWFF/LLOTA wiring at every surface. WWBOTA's spot priority
on desktop is `POTA > SOTA > WWFF > LLOTA > WWBOTA > Tiles` — slot it
in the same place in the mobile priority list.

### 1. `src/utils/spotSources.ts`

Add WWBOTA to the `PRIORITY` array. Drop it between `llota` and
`tiles` to match desktop priority:

```ts
const PRIORITY: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'sota',   label: 'SOTA' },
  { key: 'pota',   label: 'POTA' },
  { key: 'wwff',   label: 'WWFF' },
  { key: 'llota',  label: 'LLOTA' },
  { key: 'wwbota', label: 'WWBOTA' },   // ← new
  { key: 'tiles',  label: 'Tiles' },
  { key: 'dx',     label: 'DX' },
];
```

And the secondary-ref capture block — add `wwbotaReference`:

```ts
if (typeof spot.wwbotaReference === 'string' && spot.wwbotaReference.trim()) keys.add('wwbota');
```

### 2. `src/state/spotsFilters.ts`

Add WWBOTA to `ALL_SOURCES` (after LLOTA) and to the default sources
list so it shows up unfiltered on first launch:

```ts
export const ALL_SOURCES = [
  { code: 'pota',   label: 'POTA' },
  { code: 'sota',   label: 'SOTA' },
  { code: 'wwff',   label: 'WWFF' },
  { code: 'llota',  label: 'LLOTA' },
  { code: 'wwbota', label: 'WWBOTA' },   // ← new
  { code: 'dxc',    label: 'DX Cluster' },
] as const;

const DEFAULT_FILTERS: PersistedFilters = {
  // ...
  sources: ['pota', 'sota', 'wwff', 'llota', 'wwbota', 'dxc'],
};
```

### 3. `src/state/desktopSettings.ts`

Surface `enableWwbota` alongside `enableLlota`. Default to `true`
(matches desktop default — bunkers are noisy enough that opt-out is
the right shape).

If you keep per-source toggles in a Settings screen, add a WWBOTA row
there. Wire the toggle to the existing `set-sources` push:

```ts
ws.send(JSON.stringify({
  type: 'set-sources',
  sources: { pota, sota, wwff, llota, wwbota, tiles, cluster },
}));
```

### 4. `src/protocol/echocatProtocol.ts` (or wherever Spot is typed)

Add the new fields to the `Spot` type:

```ts
interface Spot {
  // ...
  wwbotaScheme?: string;
  wwbotaReference?: string;
  wwbotaSecondaryRefs?: string[];
  wwbotaRefsLabel?: string;
}
```

The `source` string union should accept `'wwbota'`.

### 5. Spot row / detail UI (`SpotRow.tsx`, `SpotRowLong.tsx`, `SpotDetailSheet.tsx`)

- **Color**: slate gray. Desktop palette:
  - Dark theme: `#78909c`
  - Light theme: `#90a4ae`
  - High-contrast (WCAG): `#4a5c66`
- **Label**: `WWBOTA`
- **Reference display**: prefer `wwbotaRefsLabel` (e.g. `"B/ON-1047 +4 more"`)
  when present and `wwbotaSecondaryRefs.length > 0`, otherwise just `reference`.
- **Park name**: `parkName` field as-is — many WWBOTA names are non-English
  (German, French, Italian); keep the original UTF-8.
- **External link** (if you have one for POTA/WWFF/LLOTA): point at
  `https://wwbota.net/cluster-2/` — the API doesn't expose stable
  per-bunker URLs.

### 6. `LogQuickSheet.tsx` — ref input + re-spot toggle

Mirror the LLOTA path:

- New ref input row for WWBOTA when the active spot's source is `wwbota`,
  placeholder `B/G-2392` or first secondary ref.
- N-fer: WWBOTA is the *most* n-fer-heavy program (the sample payload
  in `lib/wwbota.js`'s doc shows a 5-bunker activation). If your log
  sheet supports comma-separated refs for WWFF, support it for WWBOTA
  too — but only one ref goes to the desktop's re-spot POST (the API
  POST takes a single comment string; the desktop prepends the
  primary ref).
- Re-spot checkbox — when checked, set both `wwbotaRespot: true` and
  `wwbotaReference: <ref>` on the `log-qso` payload.
- ADIF mapping — `wwbotaRef` goes through to the desktop alongside
  `potaRef` / `sotaRef` / `wwffRef` / `llotaRef`.

### 7. `Storage.ts` — settings persistence

If you cache `enableLlota` / `enableWwff` locally, add `enableWwbota`
to the persisted shape so toggle state survives app restarts before
the first `set-sources` push lands.

### 8. Anywhere else mode/source enums live

Check for `'pota' | 'sota' | 'wwff' | 'llota'` union types or
`['pota', 'sota', 'wwff', 'llota']` arrays — grep TypeScript for
that pattern and add `wwbota` consistently. Known hot spots from
earlier triage:

- `src/screens/SpotsScreen.tsx`
- `src/screens/PropScreen.tsx`
- `src/state/scan.ts`

## How to verify

1. **Spots appear** — connect mobile to a desktop on master, open the
   Spots screen during a busy WWBOTA period (EU mornings/afternoons UTC
   are best). A WWBOTA spot should render with a slate-gray badge and
   the ref like `B/G-2392`.
2. **N-fer label** — find a multi-bunker activation (5+ refs). The
   row should show `B/xx-#### +N more`, not a wall of refs.
3. **QRT filter** — flip "Hide QRT spots". WWBOTA QRTs (their
   `type:"QRT"`) drop from the list. Desktop appends `[QRT]` to
   `comments` so the existing filter catches them.
4. **Filter toggle** — turn off WWBOTA in the spot-source filter.
   All WWBOTA rows disappear. Turn it back on, they return.
5. **Log a QSO with re-spot** — tap a WWBOTA spot → Log → tick "Re-spot".
   Save. Hit `https://api.wwbota.net/spots/?age=1` from anywhere — your
   spot should appear within ~10 s. ADIF in the desktop log should
   carry `SIG=WWBOTA` + `SIG_INFO=B/G-####`.
6. **ECHOCAT web parity** — open `renderer/remote.html` on the
   desktop. The web client *doesn't yet* surface WWBOTA in the log
   multi-chip badge — that's a known gap (see note below). The
   native app should be the first ECHOCAT client to support WWBOTA
   end-to-end.

## Known gap on the ECHOCAT web (mobile-adjacent context)

`renderer/remote.js` in the desktop repo still uses a 4-program list
(`'pota', 'sota', 'wwff', 'llota'`) for its multi-chip log badge, so
WWBOTA refs round-trip correctly through `log-qso` but don't render
as a chip in the web client's quick-log UI. The native app is not
constrained by this — implement WWBOTA fully and the web client will
follow.

## Reference: desktop files touched (single commit, on master)

Grep these for `wwbota` / `WWBOTA` to see exact patterns:

- `lib/wwbota.js` — new (45 lines): `fetchSpots()` + `postSpot()`.
- `main.js` — `processWwbotaSpots()`, fetch wiring, n-fer dedup
  priority (`PROGRAM_PRIORITY` array), `panadapterAllowsSource` /
  `panadapterWantsSource`, `set-sources` push map, QSO-save +
  standalone re-spot IPCs, telemetry QSO source list.
- `renderer/app.js` — `enableWwbota` state + load/save, spot
  filter, table-row class + external link, log dialog ref + respot
  payload, banner logger type + ref placeholder, activator
  cross-program X-Ref panel, `LOG_OTA_TYPES` array.
- `renderer/index.html` — Spots filter checkbox, Settings →
  Spots toggle, panadapter source checkbox, log dialog ref row,
  re-spot template input, banner-logger type option.
- `renderer/styles.css` — `--source-wwbota` (dark/light/WCAG),
  `.spot-wwbota`, `.source-badge-wwbota`, exclusion in
  `.no-source-tint`.
- `CLAUDE.md` — file-structure entry, Current Features bullet,
  Settings list entries.

OpenAPI source of truth for the field shapes:
`https://api.wwbota.net/openapi.json` (path `/spots/`).

## Open questions to confirm with Casey when you start

- iOS-side translation of `wwbotaScheme` (e.g. `UKBOTA`, `HBBOTA`) —
  is that worth surfacing as a sub-badge next to the slate-gray
  WWBOTA tag, or is the ref prefix (`B/G-…`, `B/HB-…`) enough?
- Multi-ref n-fer ADIF: if the operator chases an n-fer activation,
  one QSO needs one ADIF row per bunker (POTA convention). Desktop
  doesn't auto-split WWBOTA n-fers on save yet — confirm whether the
  mobile log sheet should expand to multiple QSOs locally, or push a
  single QSO and let the user double-tap to expand.
