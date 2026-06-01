# Desktop POTACAT SSTV — "World Class" push handoff

**Subject:** What changed in the SSTV decoder/encoder on 2026-05-31, and what mobile (iOS/Android POTACAT) should mirror.

**Headline:** The ~3-week SSTV-no-decode regression is fixed (commit `bd7c629`, 2026-05-28) — confirmed via real-radio decode on 2026-05-31. If mobile users were also seeing "SSTV never decodes," that's the same root cause; rebuilding off the latest desktop branch resolves it.

This session pushed deeper on decoder quality. Final test posture (all CI-gated):
- `test/sstv-quality-test.js`: **52 cells, 0 regressions** (was 24 → 49 → 52)
- `test/sstv-test.js`: 179 unit + 24 pending
- `test/jtcat-test.js`: 143/143

---

## 1. New SSTV modes — TX dropdown needs 15 entries, not 5

**Desktop:** commit `c73d98f` added Martin M2/M3/M4, Scottie DX, Robot 24. Commit `ca2bb37` (earlier) added PD-90 through PD-240. Both desktop popout (`renderer/sstv-popout.html`) and ECHOCAT mobile remote (`renderer/remote.html`) were updated to show all 15 modes as `<optgroup>`s by family (commit `6babe55`).

**iOS/Android needs:** TX mode picker should include all 15 modes, organized by family. Decode is mode-agnostic (the decoder auto-detects via VIS); this is purely about what the user can SELECT to transmit.

Mode list with VIS codes (canonical, do not change):

| Family | Mode | VIS | Width × Height | TX time | Notes |
|---|---|---|---|---|---|
| Martin | M1 | 44 | 320×256 | 114 s | most common |
| Martin | M2 | 40 | 160×256 | 58 s | |
| Martin | M3 | 36 | 320×128 | 57 s | |
| Martin | M4 | 32 | 160×128 | 29 s | |
| Scottie | S1 | 60 | 320×256 | 110 s | |
| Scottie | S2 | 56 | 320×256 | 71 s | |
| Scottie | DX | 76 | 320×256 | 269 s | very slow |
| Robot | 24 | 4 | 160×120 | 24 s | YCbCr, half-chroma |
| Robot | 36 | 8 | 320×240 | 36 s | YCbCr, half-chroma |
| Robot | 72 | 12 | 320×240 | 72 s | YCbCr, full chroma |
| PD | 90 | 99 | 320×256 | 90 s | YCbCr, line-paired chroma |
| PD | 120 | 95 | 640×496 | 126 s | |
| PD | 160 | 98 | 512×400 | 161 s | |
| PD | 180 | 96 | 640×496 | 187 s | |
| PD | 240 | 97 | 640×496 | 248 s | |

**ECHOCAT protocol:** no change. `sstv-photo` from client still passes `{ mode: "<modeKey>" }`. Server already handles all 15 keys. Just add the options to the picker.

---

## 2. Post-processing on decoded images — opt-out setting

**Desktop:** commit `40fb77f` added `lib/sstv-post.js` — MMSSTV-style unsharp mask + saturation boost + gamma correction applied to every decoded image before save/display. Default ON.

**Setting:** `sstvPostProcess` (boolean, default `true`). Stored in `settings.json`. When `false`, decoded images are raw.

**Defaults (in `lib/sstv-post.js`):**
- `unsharpStrength: 0.6` (MMSSTV-typical)
- `saturation: 1.15` (subtle pop)
- `gamma: 1.0` (no change)

**iOS/Android needs:**
1. Add a Settings toggle "Polish decoded SSTV images (MMSSTV-style)" defaulting to ON. This matches the desktop default and what users expect from "looks like MMSSTV."
2. The `sstv-rx-image` ECHOCAT broadcast (server→client) sends the image AFTER post-processing if the desktop's setting is on. So the mobile client receives an already-polished PNG over the wire. Mobile doesn't need to re-implement the filters.
3. If mobile wants its OWN post-process toggle that runs client-side on RAW images (e.g. for users who keep desktop's post-process off), see `lib/sstv-post.js` for the algorithms — they're pure RGBA functions, easy to port.

**Protocol note:** `sstv-rx-image` payload is unchanged. The post-processing happens upstream of the broadcast. If you want mobile to receive RAW images and post-process locally, that's a new feature — propose it on the ECHOCAT protocol side first.

---

## 3. Manual slant slider — UX feature for residual-slant correction

**Desktop:** commit `fe533d4` added a slider below `rx-canvas` in the SSTV popout. After a decode lands, the user can drag ±60 px to horizontally shear the image and correct residual slant that survived the auto-slant regressor. Live re-render. Resets per decode.

**iOS/Android needs:** consider adding the same UX. It's purely a client-side post-render correction on the already-decoded RGBA — no decoder changes. Useful when severe drift or weak signals produce a slightly skewed image. MMSSTV has the equivalent and users expect it.

**Implementation:** see `renderer/sstv-popout.js` — `renderSlantedImage(rxImage, slantPx)` is ~20 lines of pure JS that walks each row and shifts pixels by `Math.round(slantPx * y / (h-1))`. Trivial to port.

---

## 4. Quality regression test infrastructure — replicate on mobile

**Desktop:** `test/sstv-quality-test.js` is now a 52-cell PSNR regression matrix with deterministic noise, drift, and a **real-radio fixture** (`test/fixtures/sstv-smartsdr-direct-noise-24k.pcm`) that exercises the leader-purity gate that fixed the 3-week regression.

**iOS/Android needs:** if mobile has its own SSTV decoder (vs. relying on desktop via ECHOCAT), build the equivalent matrix. Even a 10-cell version protects against the same class of bug.

**Key recommendations:**

1. **Use deterministic noise seeds.** White Gaussian noise with a known seed (e.g. `(s * 1664525 + 1013904223) >>> 0`) produces reproducible per-cell PSNR. Critical for catching regressions.

2. **Include a "no-false-emit on band noise" cell.** Feed pure noise (or better, an actual radio-noise WAV fixture). Assert ZERO image events. This is what would have caught the 3-week regression at CI time.

3. **Don't aggregate into a single pass/fail.** Each (mode, drift, snr) cell logs its own PSNR vs. baseline so regressions are pinpointable.

4. **Ratchet baselines up on legitimate improvements.** Never widen tolerance to admit a regression.

---

## 5. The 3-week SSTV-no-decode regression — root cause + fix

**Desktop:** commit `bd7c629` (2026-05-28). Root cause: the leader detector accepted any sustained 1900 Hz envelope energy. SmartSDR Direct VITA-49 audio delivered loud band noise (rms ~0.22) whose 1900 Hz envelope sustained long enough to trip an 80 ms "leader," causing the decoder to false-lock a bogus mode and grind through 1–3 minutes of a noise decode while real SSTV headers passed by.

**Fix:** gate the IDLE→LEADER transition on tone purity:
- Measured leader frequency must be within ±250 Hz of 1900 Hz
- Std of the leader frequency across the lock window must be under 450 Hz

**iOS/Android relevance:** if mobile has its own SSTV decoder, it almost certainly has the same vulnerability. The pattern to test for:

```javascript
// During the leader-detection state, accumulate measured frequency:
this.leaderFreqAccum += rawFreq;
this.leaderFreqSqAccum += rawFreq * rawFreq;
this.leaderFreqCount++;

// When the leader threshold is reached, check tone purity:
const measuredLeader = this.leaderFreqAccum / this.leaderFreqCount;
const variance = Math.max(0, this.leaderFreqSqAccum / this.leaderFreqCount - measuredLeader * measuredLeader);
const leaderStd = Math.sqrt(variance);

// Real leader (even 8 dB SNR): mean≈1900 Hz, std≤391 Hz
// Band noise:                  mean≈1747 Hz, std≈537 Hz
if (Math.abs(measuredLeader - 1900) > 250 || leaderStd > 450) {
  // Reject — this is noise, not a leader. Stay in IDLE.
  return;
}
```

**The fix is in `lib/sstv-worker.js` `_stateIdle`** if you want to copy the JS verbatim. ~20 lines.

---

## 6. Smaller decoder improvements worth knowing about

**MAD-based slant regressor** (commit `13a615b`, `lib/sstv-dsp.js`):
Replaces static-tolerance outlier rejection with 4σ residual-MAD rejection + OLS refit. Lifted PD/Martin M2/M4/Robot 24 by 1–3 dB. If mobile has a slant regressor, this is a worthwhile upgrade.

**Robot 36 sync vulnerability fix** (commit `1793aba`, `lib/sstv-worker.js`):
Late-trigger slant updates were over-correcting on noise patterns in YCbCr modes. Fix: freeze late-trigger updates after line 96 for YCbCr modes UNLESS the line-12 trigger detected real drift (>300 ppm). +9.5 dB on the worst seed=1 noise cell.

**Width-validated sync peak detector** (in commit `1793aba`):
If the simple-max sync peak isn't broad (>=50% of samples in ±syncMs/2 window above peak*0.5), fall back to a boxcar matched-filter position. Catches impulse-noise spikes that beat real sync plateaus.

These are decoder-internal. Only relevant if mobile maintains its own decoder.

---

## 7. Known weaknesses (NOT shipped fixes — be careful)

If mobile asks "should we wait for these to ship before our release?" — no. Ship now. These are tracked but not blocking:

**PD modes at 12–15 dB PSNR** (MMSSTV is ~25 dB). Root cause: PD's long 20ms sync keeps the BPF saturated through the post-sync porch, so the peak tracker captures the next line's BPF anticipation instead of the current line's sync. Empirical edge-correction was tuned for short syncs. Documented with diagnostic probes in `scripts/probe-pd-decode.js` and `scripts/probe-linestart.js`. Fix requires re-tuning the sync detection without regressing Martin/Robot (which currently work via a fortunate coincidence).

**Robot 36/72 at ±1000 ppm drift sit at ~21 dB.** Channel modes hit 25+ dB. Two-pass replay is disabled for YCbCr modes because the linear-interp resampler produces sharp-but-wrong-color output. Needs a SSIM-style quality gate; tried sharpness-only and sync-ratio gates, both insufficient.

If mobile sees similar weak points, don't try to "fix" them with quick patches — they're deferred deliberately. The next session will revisit.

---

## 8. What to tell your users

If iOS/Android users have been complaining "SSTV doesn't work" for the last few weeks, the fix is on master. The decoder now produces clean decodes on Martin/Scottie/Robot in the field (Casey K3SBP confirmed first good decode 2026-05-31). PD modes work but at lower quality than MMSSTV — recognizable images but visibly soft.

The full 15-mode TX list is now available. Post-processing makes decoded images look more like MMSSTV's output. Manual slant correction is available for residual-skew rescue.

If users specifically want PD-180 weak-signal performance equal to MMSSTV, tell them honestly that's the open item; field testing on the modes that ARE solid will produce better experience than chasing the one that's not yet.

---

## File map (in case mobile wants to copy-paste algorithms)

| What | Where | Notes |
|---|---|---|
| Mode definitions | `lib/sstv-modes.js` | VIS codes, dimensions, timing — canonical |
| Encoder + decoder | `lib/sstv-worker.js` | Single file, ~1900 lines |
| DSP primitives | `lib/sstv-dsp.js` | BiquadBPF, BiquadLPF, ToneEnvelope, SlantRegressor |
| Post-processing | `lib/sstv-post.js` | Pure RGBA functions, easy to port |
| Engine wiring | `lib/sstv-engine.js`, `lib/sstv-manager.js` | Event-emitter glue, multi-slice support |
| Tests | `test/sstv-test.js`, `test/sstv-quality-test.js` | 52-cell quality + 179 unit |
| Real-radio fixture | `test/fixtures/sstv-smartsdr-direct-noise-24k.pcm` | 469 KB, the exact noise that caused the 3-week bug |

Memory pointer for next session: `project_sstv_world_class_push_2026_05_31.md` in the desktop Claude's memory directory has the full session breakdown including grade-by-mode, deferred items, and "load-bearing comments not to touch."
