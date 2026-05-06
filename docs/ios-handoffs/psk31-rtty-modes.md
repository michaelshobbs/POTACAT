# PSK31 + RTTY mode parity for the iOS app

Status: open
Filed: 2026-05-06
Repo for changes: D:\Projects\potacat-app

## Context

The desktop POTACAT (this repo, master at v1.5.16+) just added first-class support for PSK31 and RTTY across the spot table, mode filters, log sheet, and rig tune mappings. The iOS app needs the same modes to be filterable, displayable in spot rows, selectable when logging, and not fall through to an "Other" bucket. RTTY was partially supported already; PSK31 is fully new.

## What the desktop now sends

- **Spots over WebSocket** can carry `mode: "PSK31"` or `mode: "RTTY"` from any source — POTA / SOTA / WWFF / LLOTA APIs, PSKReporter, RBN, DX cluster (now infers `PSK31` from comment text). Pass-through; no protocol change.
- **`log-qso` reply**: when the user logs a QSO via `LogQuickSheet`, the desktop accepts the mode field as-is. Already works for any string. The desktop's QSO-list `all-qsos` push (which the app already subscribes to) will include PSK31/RTTY entries naturally.
- **Pairing tokens / cert / WebRTC**: unchanged.

## What needs to change in the iOS app

Investigate `D:\Projects\potacat-app\src` and add PSK31/RTTY at these surfaces. RTTY may already be in some of them — check before adding.

### 1. Spot row display

Wherever a spot's `mode` field is rendered, make sure `"PSK31"` and `"RTTY"` render as-is. They probably already do; verify no "unknown mode" handling drops them.

### 2. Mode filter UI

Find the spot-table filter component (likely in `src/components/` or `src/screens/SpotsScreen.tsx`). Wherever there's a list of mode options like `['CW', 'SSB', 'FT8', 'FT4', 'FM', 'RTTY']`, add `'PSK31'`. If RTTY is missing too, add both. Multi-select pattern should match the desktop's mode multi-dropdown.

### 3. Log sheet — `src/components/LogQuickSheet.tsx`

The mode picker in the modal. Add PSK31 option to the dropdown/picker. If there's a `defaultRst(mode)` helper similar to the desktop's, treat PSK31 (and bare `'PSK'`) as a 599-style mode:

```ts
if (m === 'CW' || m === 'FT8' || m === 'FT4' || m === 'FT2' || m === 'RTTY' || m === 'PSK31' || m === 'PSK') return '599';
```

Look for `defaultRst` or similar in `LogQuickSheet.tsx` near the `useState('59')` for `rstSent` / `rstRcvd`.

### 4. Mode classification set

If there's a `KNOWN_MODES` or `DIGITAL_MODES` set (probably in `src/state/spots.ts` or `src/utils/modes.ts` if that exists), add PSK31 there so it's not bucketed as "Other" / unknown.

### 5. Mode picker for setting the rig's mode

If there's a touchscreen mode pad like the desktop's (USB / LSB / CW / FT8 / FT4 / FM / AM / RTTY / RADE), add a PSK31 button. Tapping it sends `set-mode` (or whichever) over the WebSocket; the desktop's rig-utils now translates `PSK31` → USB+DATA / PKTUSB / Icom 0x01 correctly per backend.

### 6. N-fer / ragchew screens

Anywhere there's a mode-aware UI, the same one-line addition.

## Test path

1. Connect iOS app to desktop running master.
2. Watch the spot table for a PSK31 spot from RBN (rare but happens) or PSKReporter Map. It should render with the mode visible. Filter by PSK31 → only PSK31 spots show.
3. Tap a PSK31 spot → desktop should tune to that frequency in USB+DATA mode (PKTUSB on Hamlib, MD9 on Flex). Verify the rig went to data mode.
4. Tap the L (log) button on a PSK31 spot → mode picker should default to PSK31, RST should pre-fill 599. Send → desktop logs it correctly into the ADIF.
5. Repeat for RTTY (which lives in the same digital sub-bands).

## Reference: desktop changes (commits on master)

Two commits, both small:

- `225a8b1` — PSK31 + RTTY support across spot table, filters, and rig tune
- `0912fb7` — ECHOCAT Web: PSK31 + RTTY parity with desktop

The desktop diff is ~25 lines across `lib/rig-utils.js`, `lib/dxcluster.js`, `renderer/index.html`, `renderer/spots-popout.html`, `renderer/remote.html`, `renderer/remote.js`. Grep those for `PSK31` to see the exact patterns and mirror them in TypeScript.

## Open question to confirm with the user

Is there a "Digital (all)" group filter that selects PSK31, RTTY, FT8, FT4, JS8 in one click? The desktop doesn't have it yet (deferred). If iOS users would benefit from a one-tap "all digital" mode filter, propose it.
