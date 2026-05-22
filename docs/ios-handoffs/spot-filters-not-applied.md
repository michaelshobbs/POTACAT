# Spot filters ("Hide Worked" / "New Parks Only") not applied in the app

Status: open — under investigation (iOS side appears already fixed; see note below)
Filed: 2026-05-21
For: POTACAT iOS / Android (ECHOCAT)
Reporter: K0OTC (Tyler), via Discord
Desktop side: no change needed — the data is already on the wire

## Ask

The ECHOCAT app's **Hide Worked** and **New Parks Only** spot filters do
nothing. The ECHOCAT *web* client applies them correctly; the native app
shows the same spot list regardless of the toggle state.

K0OTC: worked a station on CW and logged it via the app — the log went
through fine, but the spot stayed in the Spots list with "Hide Worked" on.

(There was an earlier, separate "new parks only shows nothing" bug that
Casey fixed in an iOS release on 2026-05-16. This is a distinct report —
the filters are reachable but inert.)

## What the desktop already sends

The desktop pushes the two datasets the filters key off (see
`docs/echocat-protocol.md`):

- `worked-parks` (S→C) — park refs the user has worked. Drives the ATNO
  badges and the **New Parks Only** filter.
- `worked-qsos` (S→C) — recent worked callsigns / refs. Drives the
  "worked" highlight and the **Hide Worked** filter.

Both are pushed on client connect and refreshed as the log changes. No
desktop change is needed — the native app just isn't filtering on them.

## What the iOS / Android app needs

Mirror the web client's filter logic, applied at render time against the
latest `worked-qsos` / `worked-parks` the app has received:

- **Hide Worked** — when on, drop spots whose callsign (+ ref) matches an
  entry in `worked-qsos`.
- **New Parks Only** — when on, drop spots whose reference is in
  `worked-parks` (show only all-time-new parks).

`renderer/remote.js` in the desktop repo is the ECHOCAT *web* client and
the reference implementation — match its callsign/ref normalization so
native and web agree.

Logging a QSO in-app should also make that spot drop on the next
`worked-qsos` push — verify that round-trip too.

## How to verify

1. Enable "Hide Worked" — spots for stations in your recent log drop off
   the list.
2. Work + log a station in-app — within a refresh its spot drops.
3. Enable "New Parks Only" — only parks you've never worked remain.
4. Toggle the same filters in the ECHOCAT web client — native behavior
   should match it exactly.

## iOS investigation — 2026-05-21

Investigated in the iOS repo (`potacat-app`). Finding: **both filters are
already implemented and working in the current iOS source.** This
handoff's premise ("the native app just isn't filtering on them") is
outdated — the desktop-side triage predated the iOS fix.

- Commit `fd029ec` (2026-05-16, "Fix 'Hide worked' + 'New parks only'
  filters (both were dead)") wired both filters end-to-end:
  `SpotsScreen` → `applyFilters` with `hideWorked` / `newOnly` plus
  `isWorked` / `isNewPark` callbacks.
- `workedToday` store records every in-app log locally (`recordLog`,
  called from `LogQuickSheet` + `LogScreen`) and also merges the
  desktop's `worked-today` push. `workedParks` store consumes
  `worked-parks`. Desktop emits both messages (`remote-server.js`).
- K0OTC's exact scenario — log a CW QSO in-app, expect the spot to drop
  with "Hide Worked" on — is handled correctly and is covered by passing
  unit tests (`__tests__/spotsFilter.test.ts`: 6 hideWorked/newOnly
  cases; full suite 133/133 green).

Most likely cause of the 2026-05-21 report: K0OTC's device is running a
TestFlight build / EAS Update bundle from **before** `fd029ec`. `app.json`
uses `runtimeVersion.policy: appVersion`, so the JS fix only reaches a
device via a new native build or a published `eas update`.

Next step: confirm K0OTC's installed build version.
- If it predates 2026-05-16 → publish the fix, have him retest, then mark
  this handoff `shipped`.
- If it already includes `fd029ec` and the filters still fail → a real
  bug remains; capture a device-side session log of the incoming
  `worked-today` / `worked-parks` pushes to find the gap.
