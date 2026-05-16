# TX Audio EQ + Compressor — iOS UI

Status: open
Filed: 2026-05-16
For: POTACAT iOS
Reporter: Casey
Desktop side: shipped (commit pending — see desktop master)

## Ask

Add an "Audio EQ" section to the iOS TX/audio settings screen that
reads + writes the desktop's TX EQ + compressor state over the
existing ECHOCAT WebSocket. Desktop already ships the DSP and the
wire protocol; iOS just needs the UI.

## Why

IC-7300, IC-705, IC-9700, and several other rigs disable their
internal speech compression and TX EQ when in DATA mode. POTACAT's
SSB-over-DATA setting forces DATA mode on the bridge mic path, so
remote ops were always getting bypassed audio. Desktop now applies
EQ + compressor in software before audio reaches the rig (whether
the audio source is iOS WebRTC mic, desktop VFO PC-mic, or future
sources). Mobile ops should be able to switch presets without
walking to the shack PC / RDPing in.

## Wire protocol (already shipped on desktop)

Single message type, used in both directions.

### Mobile → desktop (set)

```jsonc
{ "type": "tx-eq-set", "enabled": true, "preset": "pileup" }
```

Desktop persists to `settings.txEqEnabled` / `settings.txEqPreset`,
applies live to whichever audio path is active (no PTT restart
required), and echoes the new state to every connected client via
`tx-eq-state` (below).

### Mobile → desktop (query)

```jsonc
{ "type": "tx-eq-get" }
```

Desktop replies with `tx-eq-state`. Mostly redundant — desktop also
pushes `tx-eq-state` on client connect, so iOS shouldn't need to
poll. Useful for a manual refresh button if you want one.

### Desktop → mobile (state)

```jsonc
{ "type": "tx-eq-state", "enabled": true, "preset": "pileup" }
```

Pushed:
- On every ECHOCAT client connect (initial hydration).
- After any change from Settings dialog, VFO popout, or another
  mobile client. Includes the case where mobile itself sent
  tx-eq-set — desktop echoes back so all connected surfaces stay in
  sync.

## UI suggestion

Three controls, mirror the desktop's:

| Control | Type | Values |
|---|---|---|
| Enable EQ + Comp | Toggle | bool, default off |
| Preset | Segmented / picker | `ragchew`, `pileup`, `dx` |
| Help text | Read-only | "Compensates for radios that disable internal EQ + compression in DATA mode" |

Preset descriptions (match what desktop shows in Settings):
- **Ragchew** — flat EQ, light 2:1 compression. Conversational
  quality.
- **Pileup** — −3 dB @ 120 Hz, +6 dB @ 2 kHz, 4:1 compression.
  Cuts mud, lifts intelligibility band.
- **DX** — −6 dB @ 120 Hz, +9 dB @ 2 kHz, 6:1 compression.
  Aggressive — for weak/poor conditions, may sound "tight".

Dim the preset picker when Enable is off (desktop convention).

When the desktop side echoes `tx-eq-state`, treat values as
authoritative — overwrite local UI state even if it was just changed
by the user (debounce to suppress the visible flicker if the echo
arrives within ~100 ms of the change).

## What desktop does NOT do

- **Per-rig defaults** — Phase 3 on the desktop side. The single
  preset applies regardless of which rig is connected. iOS UI
  doesn't need to worry about this.
- **Custom slider knobs** — Phase 2 on the desktop side. iOS UI
  just needs the 3 presets for v1.
- **VU meter / spectrum** — not in v1. Could be a follow-up if you
  want pre/post compressor metering.

## How to verify

1. Phone: open the new Audio EQ panel. Verify the toggle + preset
   match whatever desktop is currently set to (Settings → ECHOCAT →
   TX EQ + Compression, or VFO popout's "TX EQ" widget).
2. Toggle Enable from phone — desktop's Settings dialog + VFO popout
   widget both update within a second. Disable it again, same.
3. Change preset from phone while on a rig that uses the
   daxTxDirect path (Flex on SmartSDR Direct, or Elecraft K4 over
   network). PTT from phone — audio character changes between
   presets (Ragchew → Pileup → DX is dramatic; Ragchew on/off is
   subtle).
4. Change preset from desktop's Settings dialog — phone UI reflects
   it within a second.
5. Disconnect + reconnect phone — the EQ panel hydrates to current
   desktop state on reconnect (no polling, no manual refresh).

## Desktop commits (for context)

- e4ec277 — Phase 1 (3 presets, desktop only, via Settings dialog)
- (pending) — VFO popout EQ widget + iOS WS protocol + PC-mic
  capture on SmartSDR Direct / K4 network paths
