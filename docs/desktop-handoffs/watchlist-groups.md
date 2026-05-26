# Watchlist Groups — Mobile Handoff

**Desktop ref:** commit `17fa320` (master) on `D:\Projects\potacat-dev`.
**Mobile repo:** `D:\Projects\potacat-app`.

## What shipped on desktop

Three independent **color-coded watchlist groups** that decorate the callsign in
the spot table. Separate from the existing single `watchlist` setting (which
remains the only thing that triggers desktop notifications + the ⭐ badge).

Defaults — all three user-overridable via a color picker per group:

| Group | Default name | Default color |
|---|---|---|
| 0 | _(empty — user types e.g. "My Club")_ | `#ff7066` Coral |
| 1 | _(empty — user types e.g. "CW Group")_ | `#82b1ff` Sky |
| 2 | _(empty — user types e.g. "Discord")_ | `#b388ff` Lavender |

Decoration on desktop: the **whole spot row** gets a 14% background tint
of the group's color plus a 2 px–3 px frame in the full-strength group
color (top/bottom on every cell, 3 px on the leftmost and rightmost cells)
via inset `box-shadow` on each `<td>` — TR borders don't render reliably
under `border-collapse`, so cell-level box-shadows form the frame
together. The source's existing `border-left` on the row sits just
outside the watchlist frame, so source + group are both readable in one
glance. Cat-paw / donor badges sit alongside, unchanged.

**Mobile and desktop align on row-level decoration.** Both surfaces tint
the whole spot row in the group color rather than calling out just the
callsign — at-a-glance scannability matters on both. The exact frame
mechanism differs (mobile uses a 3 px left border + tinted card
background; desktop uses inset `box-shadow` cells), but the visual
intent is identical.

## Settings shape (the contract)

The desktop persists the groups under a new top-level settings key. Mobile sees
this on the next settings push exactly as written:

```ts
type WatchlistGroup = {
  name: string;        // user-visible, 0-40 chars, may be empty
  color: string;       // '#rrggbb', validated by the desktop on save
  callsigns: string;   // free-form text the user typed/imported.
                       // Separators: comma / whitespace / newline.
                       // Items may have legacy ':band:mode' qualifiers
                       // (from the original watchlist syntax) — ignore
                       // them in groups; group match is callsign-only.
};

type Settings = {
  // … existing fields …
  watchlist: string;                     // legacy single watchlist (unchanged)
  watchlistGroups?: [
    WatchlistGroup,
    WatchlistGroup,
    WatchlistGroup,
  ];
};
```

Always-three: when present the array is exactly length 3 (indices 0/1/2). When
absent (older desktops, or a user who never opened Settings), mobile should
treat it as the three defaults above with empty `name` and empty `callsigns`.

The desktop validates `color` against `/^#[0-9a-f]{6}$/i` before saving — if a
malformed value somehow reaches mobile, fall back to the defaults per index.

## Prerequisite: desktop change first

`updateRemoteSettings()` at `main.js:4800-4852` is an explicit allowlist of
which settings keys go to ECHOCAT clients. As shipped, `watchlistGroups` is
not in the list, so mobile's `auth-ok.settings.watchlistGroups` arrives
`undefined` regardless of what's persisted on disk.

Add one line, matching the pattern `customCatButtons` follows:

```js
watchlistGroups: settings.watchlistGroups || null,
```

Without this, mobile builds against a contract the desktop doesn't fulfill.
Verify on the next desktop release before mobile starts implementing.

## What mobile needs to build

1. **Parse + lookup helper.** Mobile should build the same
   `Map<UPPERCASE_CALL, groupIdx>` once when the settings push lands, and rebuild
   when settings change. The desktop's parser logic (port verbatim):

   ```ts
   function parseCallsignList(str: string): string[] {
     if (!str) return [];
     return str
       .split(/[\s,;]+/)
       .map(s => s.split(':')[0].trim().toUpperCase())
       .filter(s => s.length > 0);
   }

   function buildLookup(groups: WatchlistGroup[]): Map<string, number> {
     const out = new Map<string, number>();
     for (let i = 0; i < groups.length; i++) {
       for (const call of parseCallsignList(groups[i].callsigns)) {
         if (!out.has(call)) out.set(call, i);   // first-match-wins
       }
     }
     return out;
   }
   ```

   First-match-wins matches desktop behavior — important so a call in multiple
   groups picks the same color on both surfaces.

2. **Apply to the spot row container.** Mobile decorates the **whole row**
   (the spot-row card/list item), not the callsign cell. Reason: phone
   surface area is too small for a 2 px cell outline to read at a glance.
   Wherever `SpotRow` renders, look up the group index. If `>= 0`:

   - Tint the row card background with the group's color at ~12% alpha
     so the source-tag column and the rest of the row stay readable.
   - Add a 3 px left border in the full-strength group color along the
     row's leading edge as a clear group flag. (The existing source
     visual lives in the source-tag column, not as a row border — no
     conflict.)
   - Set the row's `accessibilityLabel` to include the group's `name`
     when non-empty (e.g. "K3SBP, watchlist group: My Club"). Empty
     name → still decorate, just don't add the label suffix.

   No long-press tooltip — RN has no built-in tooltip primitive and the
   cost of building one isn't justified for a "what group is this?"
   secondary signal. The accessibility label covers screen-reader users.

3. **Settings screen — three group editors.** Mobile uses a fixed color
   palette instead of a free-form picker (RN has no built-in color picker
   and pulling in a 3rd-party lib is unjustified for a 5-choice selection).
   Each editor surfaces:

   - **Name input** (text, 0-40 chars).
   - **Color swatch grid** — 5 swatches per theme, see the palettes below.
     Tap to select; the active swatch shows a thick border. If the persisted
     hex value isn't in the palette (e.g. desktop user picked a custom
     color via `<input type="color">`), render it as a sixth "Current"
     swatch outside the grid so the user sees what's there but doesn't
     have to overwrite it just to make another edit.
   - **Multi-line text area for callsigns.** Accept comma / whitespace / newline.
   - **Import CSV** button using `expo-document-picker` (or platform
     equivalent). Read the file as text, take the first column of each row,
     validate each candidate against `/^[A-Z0-9\/]{3,15}$/i`, dedup against the
     existing list, and merge — don't replace. Tolerate quoted CSV fields and
     CRLF line endings. The desktop's algorithm:

     ```ts
     const calls: string[] = [];
     for (const row of text.split(/\r?\n/)) {
       if (!row.trim()) continue;
       let first = row.includes(',') ? row.split(',')[0] : row;
       first = first.replace(/^["\s]+|["\s]+$/g, '');
       if (first && /^[A-Z0-9\/]{3,15}$/i.test(first)) {
         calls.push(first.toUpperCase());
       }
     }
     ```

   - **Clear** button — wipes the textarea (user still has to Save).

   ### Color palette (5 + 5)

   Picked to satisfy three constraints: (a) distinct from each other within
   a theme so three groups in view stay distinguishable, (b) distinct from
   the existing source-tag colors (POTA green / SOTA orange / WWFF teal /
   LLOTA sky / DXC magenta / RBN cyan / PSKR red / NET yellow) so a group
   tint doesn't read as a source signal, (c) the 12% alpha tint reads
   clearly against the theme's row card background.

   The persisted `color` value is always the **full-strength hex** below.
   The mobile renderer derives the 12% alpha tint at draw time (RN supports
   `rgba()` color strings, so `#ff7066` becomes `rgba(255,112,102,0.12)`
   for the background and stays full-strength for the left border).

   **Light mode palette** (saturated tints that read on `#ffffff` cards):

   | Slot | Name     | Hex       |
   |------|----------|-----------|
   | 0    | Coral    | `#ff7066` |
   | 1    | Sky      | `#82b1ff` |
   | 2    | Lavender | `#b388ff` |
   | 3    | Rose     | `#ec407a` |
   | 4    | Amber    | `#ffa726` |

   **Dark mode palette** (lifted brightness so the same 12% alpha is
   visible on `#15181d` cards — straight-luminance versions of the light
   palette would mud out):

   | Slot | Name     | Hex       |
   |------|----------|-----------|
   | 0    | Coral    | `#ff8a80` |
   | 1    | Sky      | `#90caf9` |
   | 2    | Lavender | `#ce93d8` |
   | 3    | Rose     | `#f48fb1` |
   | 4    | Amber    | `#ffcc80` |

   Slot index is informational only — mobile stores and reads the hex,
   matching the desktop's data model.

   The defaults listed in the top "Settings shape" table (`#ff7066`,
   `#82b1ff`, `#b388ff`) intentionally match light-mode slots 0/1/2 so a
   fresh install lands on a sensible default set without any user picks.

   - **Save** flow — write the three groups back through the existing settings
     save pipe (the same one that owns `myCallsign`, `watchlist`, etc.) as
     `watchlistGroups`. Desktop merges via `{...settings, ...newSettings}`, so
     mobile partial saves are safe.

4. **Live swatch updates.** Tapping a swatch immediately updates the row
   tint preview in any visible Spots list (treat swatch tap as a draft state
   that re-renders the list without persisting). Persist on the screen's
   normal Save flow / blur — matches the rest of mobile Settings, no
   special "live save" plumbing needed.

## What mobile should NOT do

- **Don't push notifications for group matches.** Notifications stay on the
  legacy `watchlist` setting only (already in place). The groups are a purely
  visual signal; promoting them to push would invert user expectations.
- **Don't trigger sounds / haptics on group match.** Same reason.
- **Don't override the source-tag column** when tinting the row. The source
  badges (POTA / SOTA / DXC / etc.) need to remain readable; the row tint
  is a soft background only, not a saturated fill. The 12% alpha guidance
  in §2 above keeps both signals legible at once.

## Versioning

- `watchlistGroups` ships in desktop v1.7.5 (next tagged release after
  `5f7dbe0`). Until users have v1.7.5 installed, mobile won't see this key in
  settings pushes — treat its absence as "no groups configured" and fall back
  to defaults.
- The shape is intentionally future-proof: if we add a 4th group later, the
  array length changes but the per-element schema doesn't. Mobile should
  iterate over `watchlistGroups.length` rather than hard-coding 3.

## Test checklist

- [ ] Row tint + left border visible on the main Spots list for any call in
      a group.
- [ ] Same row tint applied to the spot popup on MapScreen (the WebView
      popup that opens when tapping a marker).
- [ ] Multiple groups configured — three distinct tint colors render per
      call across the visible list.
- [ ] Call in two groups — picks the lower-indexed group (matches desktop).
- [ ] CSV import dedups against existing callsigns in the same group.
- [ ] Tapping a different swatch in the Settings group editor re-tints the
      visible Spots list without an app reload (draft state re-render).
- [ ] Group name appears in the row's `accessibilityLabel` (verified via
      iOS VoiceOver or Android TalkBack).
- [ ] Out-of-palette hex from desktop (e.g. `#abcdef` set via desktop
      free-form picker) renders correctly as a row tint AND is offered
      as the sixth "Current" swatch in the mobile picker.
- [ ] Invalid color value (`#zzz`, `'red'`, `null`) falls back to the
      slot's default without crashing.
- [ ] `watchlistGroups` survives a settings round-trip (desktop save →
      mobile read → mobile save → desktop read) with no data loss.
