# Handoff → Mobile: JTCAT decode-list filters + sort (CQ/73, Wanted, dB) apply to PRE-EXISTING decodes

**Audience:** iOS/Android (ECHOCAT) agent.
**Status as of desktop:** **shipped** in the desktop **JTCAT pop-out** (`renderer/jtcat-popout.js`). The pop-out is the only JTCAT UI desktop users see, and it now re-filters/re-sorts the decodes already on screen the instant a control is toggled.
**Important:** the ECHOCAT **web** client (`renderer/remote.js`) — which the native app has historically mirrored — **has the same bug this fixes** (its filter/sort buttons only affect *future* decodes). So for this feature, **mirror the desktop pop-out, NOT `remote.js`'s current behavior.** Treat `remote.js` here as "what not to copy." (`remote.js` should get the same fix later; tracked separately.)
**Why this exists:** the operator turns on **Wanted** or **CQ/73**, or taps **dB** to sort by signal, expecting the decode list *currently on screen* to immediately filter/sort. Today (mobile + old pop-out) the buttons just flip a flag — nothing already rendered changes; only the next decode cycle reflects it. That reads as "the button is broken."

---

## 1. The desired behavior (one sentence)

The decode-list controls — **CQ/73**, **Wanted**, **Chase**, **dB (sort by signal)**, and the **text search box** — must **re-render the retained decode buffer through the current filters + sort every time one of them changes**, so they act on the decodes already displayed, not only on cycles that arrive afterward.

## 2. The mechanism (how the desktop pop-out does it — copy this shape)

The pop-out keeps a retained buffer of recent decode cycles and rebuilds the list pane from it on every toggle. Reference: `renderer/jtcat-popout.js`.

Structure (all within the pop-out's renderer closure):

- **Retained buffer:** `decodeLog = [{ time, results }]`, capped at 50 cycles (`results` = the array of decode objects the desktop sent for that cycle).
- **Pure helpers (shared by the live path and the rebuild path so they can't drift):**
  - `classifyDecode(d)` → `{ d, text, upper, isCq, isDirected, is73, isWanted }`
  - `decodeVisible(c)` → bool, applies the current filter flags (see §3)
  - `sortDecodes(results)` → returns a dB-sorted copy when sort is on, else the array as-is
  - `buildBandRow(c)` → builds one row element (badges, classes, click handler)
- **`appendBandCycle(time, results)`** — appends ONE cycle to the list applying filters+sort; if a filter hides every decode in the cycle it adds **no separator** and returns 0.
- **`rebuildBandActivity()`** — clears the list and replays the whole `decodeLog` through `appendBandCycle`, then caps the visible cycles (leak fix). **This is what every control handler calls.**
- **Live decode arrival** still does an efficient single-cycle append (`appendBandCycle`) — only *toggles* pay for a full rebuild.

Each control handler is now: `flag = !flag; button.setActiveState(flag); rebuildBandActivity();`

## 3. Filter semantics — match these EXACTLY (the subtle part)

A decode passes the filter unless a rule below excludes it. **Directed decodes and 73s always pass** — this is deliberate so the operator never loses a reply to their own CQ (or a station signing 73) behind a filter.

```
isCq       = text.toUpperCase().startsWith("CQ ")
isDirected = myCallsign present AND text contains my callsign as a token
is73       = text contains "RR73" OR " 73"
isWanted   = decode.newDxcc OR decode.newCall OR decode.newGrid   (flags the DESKTOP sets)
chaseMatch = decode.chaseMatch                                    (flag the DESKTOP sets — see chase-target.md)

visible(d):
  if cqFilter     and not (isCq  or is73 or isDirected)                 -> hide
  if wantedFilter and not (isWanted or isDirected or is73)             -> hide
  if chaseFilter  and not (chaseMatch or isDirected or is73)           -> hide
  if searchText   and uppercased text does NOT contain searchText      -> hide
  else -> show
```

- **`newDxcc` / `newCall` / `newGrid` / `chaseMatch` are computed by the desktop** and arrive on each decode in the `jtcat-decode` message. **Do not recompute them on mobile** (same rule as chase-target). If absent (older desktop), treat as false.
- **Sort (dB):** stable-ish sort by signal strength descending — `(b.db || 0) - (a.db || 0)` — applied to a COPY per cycle, only when the sort toggle is on. Off = preserve decode order.
- Filters compose (AND). Search is a case-insensitive substring on the raw message text.

## 4. ⚠️ Mobile-specific caveat: keep TX/auto-reply OUT of the rebuild path

In `renderer/remote.js` the live render loop (`ft8RenderDecodeRow`, ~L5958–6067) currently does **three things in one pass**: (a) renders rows, (b) clones directed rows into "My Activity" + plots the map, and (c) **runs hunt auto-reply** (`ft8Send({ type: 'jtcat-reply', … })`, ~L6002–6015).

If the native app has any equivalent side-effect (auto-reply, auto-log, map plot, TX trigger) inside its decode-render loop, you **must not** let it fire during a filter/sort rebuild — otherwise toggling a filter could re-transmit or re-plot stale decodes. Separate it:

- **On live decode arrival:** run side-effects (auto-reply, map plot, My Activity) ONCE, off the raw decode — independent of the table filters.
- **On filter/sort toggle:** rebuild the visible list ONLY. No TX, no auto-reply, no re-logging.

The desktop pop-out keeps My Activity + map plotting on the live path only; `rebuildBandActivity()` touches the decode list and nothing else. Mirror that boundary.

## 5. UI controls to wire (current identifiers, for reference)

| control | desktop pop-out (`jtcat-popout.js`) | web client (`remote.js`, **has the bug**) | state var (web) |
|---|---|---|---|
| CQ/73 filter | `#jp-cq-filter` → `rebuildBandActivity()` | `#ft8-cq-filter` (toggle only — needs fix) | `ft8CqFilter` |
| Wanted filter | `#jp-wanted-filter` | `#ft8-wanted-filter` | `ft8WantedFilter` |
| Chase filter | `#jp-chase-filter` | `#ft8-chase-filter` | `ft8ChaseFilter` |
| dB sort | `#jp-sort-signal` | `#ft8-sort-signal` | `ft8SortSignal` |
| text search | `#jp-search` (on `input`) | `#ft8-search` | `ft8SearchFilter` |

The native app's equivalents should each: update local toggle state → reflect active styling → **re-render the retained decode buffer through `visible()` + sort**.

## 6. Buffer + cap

- Retain the last **50** decode cycles (matches desktop `decodeLog`).
- The pop-out caps the *visible* list to ~10 cycles for memory (it's a long-running desktop window). On mobile, cap as fits your platform; the key point is the filter operates over the retained buffer and the rebuild is bounded. Cycles emptied by a filter contribute no separator/header.

## 7. Acceptance criteria

1. With a populated decode list, tapping **Wanted** immediately hides every non-wanted, non-directed, non-73 row already on screen; tapping it again restores them. Same for **CQ/73** and **Chase**.
2. Tapping **dB** immediately reorders the existing rows strongest-first; tapping again restores chronological order.
3. Typing in **search** filters existing rows live; clearing it restores them.
4. A reply directed at my callsign, and any "73", remain visible under **every** filter.
5. Toggling any control **never** transmits, re-logs, or duplicates map markers (see §4).
6. Newly arriving decodes continue to honor whatever filters/sort are active.

---

**Reference files (desktop, as of this commit):**
- `renderer/jtcat-popout.js` — `classifyDecode` / `decodeVisible` / `sortDecodes` / `buildBandRow` / `appendBandCycle` / `rebuildBandActivity` / `renderDecodes`. **This is the canonical reference.**
- `renderer/app.js` — `renderJtcatDecodes()` (the hidden in-window view) is an older, working rebuild-on-toggle implementation if you want a second example.
- `renderer/remote.js` — `ft8RenderDecodeRow` + the filter button handlers (~L6361–6382): the web client that still has the append-only bug. Do **not** mirror its current toggle handlers.
- Related: `docs/ios-handoffs/chase-target.md` (where `chaseMatch` / Chase filter come from).

---

## Mobile agent status — 2026-06-16 (DONE, at parity)

Implemented on ECHOCAT mobile (`src/screens/Ft8Screen.tsx` + new
`src/utils/ft8Filter.ts`). tsc clean; 311/311 unit tests
(`__tests__/ft8Filter.test.ts` covers every §3 rule incl. the
regression below).

**Good news — the core bug never existed on mobile.** The decode list
is a `useMemo(flatRows, [batches, filter, sort, myCallsign, searchText])`
that rebuilds over the *entire* retained buffer whenever any control
changes. That is structurally the same as `rebuildBandActivity()` — a
filter/sort toggle re-renders the decodes already on screen instantly.
No append-only defect to fix. §4 is also satisfied for free: `flatRows`
is a pure render memo with zero side-effects; auto-reply is
desktop-driven (mobile only sends `jtcat-reply` on an explicit user
tap), so toggling a filter can never TX, re-log, or re-plot.

**Two real gaps found + fixed for parity:**
1. **Wanted filter swallowed 73s** (violated §3 + acceptance #4). The
   `is73` bypass was present on the cq/chase branches but missing on
   wanted. Fixed: `wanted && !(isWanted || isDirected || is73)`. Now
   matches §3 exactly. Regression-tested.
2. **No text-search control existed.** Added a search row beneath the
   filter pills — case-insensitive substring over raw decode text,
   composed (AND) with the flag filters, **no directed/73 bypass** (per
   §3: explicit search = exact intent). Re-filters the retained buffer
   live per keystroke.

**Intentional mobile-side divergences (permitted by §6 / platform fit —
flagging so the contract is on record, NOT bugs):**
- **Sort is per-cycle, not global.** Mobile keeps chronological cycle
  separators and sorts *within* each time block. Desktop's `sortDecodes`
  is per-cycle too, so this agrees — calling it out only because mobile
  renders explicit "HHMM UTC" separators between blocks.
- **Bonus `Call` (A–Z) sort.** Mobile offers Time / dB / **Call**;
  desktop has Time / dB. Additive, harmless. **Desktop may want to
  mirror it** for symmetry — your call.
- **30-cycle retained buffer** vs desktop's 50 (§6 explicitly allows
  per-platform caps; 30 fits phone memory).
- **dB sort missing-SNR default** is `-999` (sinks unknown-SNR rows to
  the bottom) vs the doc's `(b.db||0)`. Cosmetic ordering of rows that
  have no SNR; trivially changeable if you want bit-exact parity.

**One thing I'd like desktop to confirm (possible doc/impl mismatch):**
§3 specifies `isDirected = … text contains my callsign **as a token**`.
Both mobile (pre-existing) and — please verify — the desktop pop-out
appear to use a **substring** check (`text.includes(myCall)`), not a
token split. I deliberately left mobile on substring because for the
stated goal ("never lose a reply to my own CQ") substring is the *safer,
over-inclusive* choice: strict token equality would MISS compound/
portable calls (`K3SBP/P`, `<K3SBP>` hashed form) that substring still
catches. **Ask:** should we (a) update §3 to document substring as the
real contract, or (b) move both sides to token matching and accept the
compound-call edge? Mobile will follow whichever you pick. Until then
both sides are consistent on substring, so there's no user-visible
divergence today.
