# Unified Waterfall — Plan

Status: in progress — Phase 1 started 2026-05-21
Owner: POTACAT desktop

## Goal

One polished, GPU-accelerated spectrum waterfall that works on **every
radio POTACAT supports**, not just radios with an IQ stream. It lives in
the main operating view (popouts reuse the same component), supports
click-to-tune, draws RX/TX markers, and overlays POTA/SOTA/cluster spots
at their frequencies.

## Motivation

Two reasons this is the next big project:

1. **Flex Direct created a gap.** POTACAT never rendered its own
   panadapter — it always leaned on SmartSDR's. Now that Flex Direct
   lets a Flex run with *no SmartSDR*, those users have **no panadapter
   at all**. This project completes Flex Direct.
2. **Conventional radios have never had a waterfall.** A Yaesu / Icom /
   Kenwood / Elecraft operator gets no spectrum display in POTACAT
   today. An audio-passband waterfall is genuinely useful — see CW
   signals, judge whether a frequency is busy, tune by eye.

## The two-waterfalls reality

There is no single "RF panadapter for every radio" — physics won't allow
it. There are two cases, and the component must serve both:

| Radio class | What POTACAT can get | Waterfall it produces |
|---|---|---|
| Flex / SDR (IQ stream) | Wideband IQ → panadapter FFT | True **RF panadapter**, kHz–MHz span |
| Yaesu / Icom / Kenwood / Elecraft (CAT + USB audio) | Demodulated AF only | **Audio-passband** waterfall, ~0–3.5 kHz |
| *(future)* IC-7300/705 etc. | CI-V scope-waveform output | True panadapter for those Icoms |

The audio-passband waterfall shows only what's inside the rig's current
filter — it is not a band-scope. That is a hard physical limit, not a
shortcoming to fix; the UI labels the span accordingly ("0–3 kHz audio"
vs "14.000–14.300 MHz").

## Current state (audit, 2026-05-21)

POTACAT has **no band waterfall**. It has two bespoke *decode-aid*
waterfalls, both popout-only:

- **JTCAT FT8** (`renderer/jtcat-popout.js`) — Web Audio `AnalyserNode`
  FFT, Canvas-2D `putImageData` shift-scroll, click-to-tune, RX/TX
  markers. ~0–3 kHz.
- **SSTV** (`renderer/sstv-popout.js`) — custom radix-2 FFT (4096, Hann),
  adaptive noise-floor/peak ranging, Canvas-2D shift-scroll, no
  click-to-tune. ~1–2.5 kHz. Has per-slice mini waterfalls.

The Canvas-2D scroll (`getImageData`→`putImageData` shift + per-pixel new
row) is duplicated three times. **No WebGL anywhere.** Bandspread is a
spot map, not a waterfall.

## Architecture

One source-agnostic component plus thin per-source adapters.

### `Waterfall` component (`renderer/waterfall.js`)

A GPU-accelerated, `<script>`-loaded class (no ES modules in POTACAT's
renderer). It consumes **FFT magnitude frames** and knows nothing about
the radio.

Rendering technique — borrowed *in concept* from AetherSDR's QRhi
waterfall, reimplemented in WebGL2:

- The scrollback history is a fixed **ring-buffer texture**
  (`bins × historyRows`, single-channel `R8`).
- Each `pushFrame()` writes **one row** via `texSubImage2D` and advances
  a `rowOffset` uniform.
- The fragment shader wraps the vertical UV with `fract(uv.y + rowOffset)`
  — the whole waterfall scrolls with **no per-frame redraw, no pixel
  copy**. This is the ~70% CPU saving AetherSDR cites.
- The colormap (magnitude → heat colour) runs **in the fragment shader**,
  so changing palette/contrast recolours instantly.

API (Phase 1):

```
new Waterfall(canvas, { bins, historyRows, colormap, gamma, newestAtTop })
  .pushFrame(Float32Array magnitudes)   // any scale — component auto-ranges
  .setMarkers([{ pos: 0..1, color, kind }])   // RX/TX lines
  .onClick(fn)                          // fn(posFraction) — host maps to Hz
  .setColormap('classic'|'turbo'|'viridis')
  .resize()                             // devicePixelRatio-aware
  .destroy()
  .supported                            // false if WebGL2 unavailable
```

Auto-ranging: adaptive noise-floor (slow EMA) + peak (fast-attack /
slow-decay), then gamma — ported from the proven SSTV logic.

### Source adapters

Each adapter produces `Float32Array` magnitude frames and calls
`pushFrame()`:

- **Audio adapter** — captures the demodulated AF (USB CODEC / DAX /
  VITA-49 / K4 Opus — POTACAT already has all of these), runs an FFT
  (the SSTV radix-2 path, shared), emits ~0–3.5 kHz frames.
- **Flex panadapter adapter** — POTACAT, as the GUI client under Flex
  Direct, creates a panadapter on the radio and subscribes to its FFT
  data stream; emits wideband RF frames.

## What we borrow from AetherSDR — and the license

AetherSDR (`github.com/ten9876/AetherSDR`, C++/Qt6, **GPL-3.0**). We do
**not** copy its source. We borrow the *technique*: the ring-buffer
texture + `fract` UV scroll, GPU rendering, the heat-map idea. That trick
is textbook graphics used by countless waterfalls — reimplementing it in
WebGL is clean (the same posture POTACAT already took with AetherSDR's
VITA-49 byte layout). Study for technique; reimplement; never paste.

## User-first decisions

Where "best for the operator" diverged from "easiest to build", we chose
the operator:

- A real **wideband RF panadapter** for the Flex (subscribe to the
  radio's `pan` stream) — not an audio FFT shortcut.
- The waterfall lives in the **main operating view**, not a popout.
- **WebGL**, not the existing Canvas-2D.
- **Spot overlay** — POTA/SOTA/RBN calls drawn on the waterfall. POTACAT
  has the spot data; no other SDR app does. This is the differentiator.

## Phases

Each phase ships operator value. Phase 3 is the hard one and is **core,
not optional** — it is sequenced after its foundation, not deferred for
being hard.

### Phase 1 — `Waterfall` core component *(in progress)*

Build `renderer/waterfall.js`: WebGL2 ring-buffer waterfall, in-shader
colormap, auto-ranging, RX/TX marker lines, click-to-tune callback,
devicePixelRatio resize. Validate by replacing the SSTV popout's
Canvas-2D waterfall with the component — instant smoother result and a
real-world shakedown.

### Phase 2 — Audio adapter + main-view integration

Audio-FFT source adapter (shared radix-2 FFT). Embed the waterfall in the
main operating view for **every radio**, with click-to-tune and the
**spot overlay**. This is the headline ("works on all radios") and the
differentiator, shipped together.

### Phase 3 — Flex true RF panadapter

POTACAT-as-GUI-client creates a Flex panadapter and subscribes to its FFT
tiles → wideband RF into the same component. Flex Direct users get a real
panadapter back — better than what they lost.

### Phase 4 — Consolidate

Move the JTCAT FT8 and SSTV waterfalls onto the shared component; delete
the triplicated Canvas-2D scroll code.

## Testing

- Phase 1: SSTV popout renders on the new component; real SSTV signal
  still shows a clean trace; CPU usage drops vs the Canvas-2D path.
- Phase 2: every rig type shows a live audio waterfall in the main view;
  clicking it tunes the rig; spots appear at the right x-positions.
- Phase 3: a Flex under Flex Direct shows a wideband panadapter that
  tracks the slice.

## Future source adapters (architecture supports, not scheduled)

- Icom CI-V scope-waveform → real panadapter for IC-7300 / IC-705 / etc.
- KiwiSDR / WebSDR remote waterfall data.
