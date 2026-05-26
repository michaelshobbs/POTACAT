# POTACAT v1.7.5 — Flex Control, Watchlist and IC-706MkII Gettin' the Love They Deserve

## Rig popover — three phases of new controls

The rig-control popover used to expose just ATU, NB, RF Gain, TX Power,
and a filter row. For a modern Flex 8600M or any IC-7300-class Icom
that's a tiny fraction of the actual control surface. Three phases of
expansion land in this release:

**Phase 1 — Toggles + AGC dropdown** (Preamp · ATT · Comp · NR · ANF · VOX,
plus an AGC Off/Fast/Med/Slow selector). Each button individually gated
by the rig's caps, so older Icoms only show what they actually support.

**Phase 2 — Continuous controls** (NR Level · NB Level · VOX Level
sliders, plus a Monitor on/off button and Monitor Level slider). The
sliders share the existing 80 ms throttle so dragging doesn't flood
the serial port.

**Phase 3 — Yaesu / Kenwood / rigctld coverage + RIT**

  - All the new toggles now work on Yaesu (FT-450/710/891/991/2000/
    FTDX3000/10/101), Kenwood (TS-2000/480/590/890/990), and Elecraft
    (K3/K3S, K4/K4D, KX2/KX3) via the existing CAT layer.
  - rigctld (hamlib) backends get the toggles AND the level sliders via
    `U` (function) and `L` (level) commands.
  - **RIT toggle** added across all rig families.

The popover now reads as a real rig-control surface instead of a token
gesture. Controls reflect the rig's actual capabilities — a 706MkII
shows different rows than an 8600M; the UI adapts.

## IC-706 MkII support

The non-G MkII (1996) finally has a proper entry in the rig database.
CI-V address `0x4E` (the MkIIG below it stays at `0x58`), the 2-byte
`[mode, filter]` form for `Cmd 0x06` that older Icoms need, and a
per-model attenuator override (`0x14` ON instead of `0x20`) so ATT
actually engages on this rig. NR / ANF are correctly off — those
landed on the IC-7000 generation, after the MkII.

## Watchlist Groups

The existing single watchlist (⭐ + notification) is now joined by
three independent color-coded groups. Original use case: one bucket
per community — local club / CW group / Discord crew / contest team
— so a hunter can tell at a glance which world an activator belongs
to.

  - **Per-group color** with a native color picker. Defaults: Coral
    `#ff7066`, Sky `#82b1ff`, Lavender `#b388ff` — picked to be
    distinct from every existing source color in the table.
  - **Per-group fallback emoji** — paste any emoji (single, compound,
    ZWJ-joined) and it decorates every callsign in that group right
    after the call text in the spot table.
  - **Ham2K PoLo URL subscription** — drop in a URL like
    `https://www.qrqcrew.club/members.txt` and POTACAT fetches it on
    app boot, on settings save when the URL changes, and on the
    per-group Refresh button. Full Ham2K PoLo spec support: per-line
    emoji from the file wins over the group's fallback. Single
    redirect followed; 15 s timeout; CAT-log line records each fetch
    result.
  - **CSV import** for one-off lists — accepts single-column or
    multi-column with callsign in column 1, dedups against existing,
    tolerates quoted fields + CRLF.
  - **Whole-row decoration** in the spot table: 14 % background tint
    plus a 3 px frame in the group's color, on top of the existing
    source-color left border. Source + group are both readable in
    one glance.
  - **iOS / Android sync** — the whole group config (including each
    group's remoteEntries cache from Ham2K PoLo) rides the existing
    ECHOCAT settings push, so phones decorate matching spots without
    having to fetch URLs themselves.

## Memory leak fix — round two

v1.7.4 contained the main-process leak with the SSTV worker circuit
breaker and the bounded IPC fan-out. This release keeps both fixes in
place; nothing new was needed on the leak side.

## Other polish

- **Upgrade-banner button** — was mint green on near-black text. Now
  deep green (`#1f7a52`) with bold white, ~7.5:1 contrast.
- **What's-New dialog re-show guard** — triple-belted with
  localStorage + sessionStorage + settings.json `lastVersion`, all
  written before the dialog opens. A force-quit mid-read can't
  replay the dialog on next launch.
