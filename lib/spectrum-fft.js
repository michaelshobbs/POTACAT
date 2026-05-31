// Minimal in-process spectrum analyzer for JTCAT.
//
// Replaces the renderer-side AnalyserNode path that was the only
// source of `jtcat-spectrum` pushes — that path required either the
// main POTACAT JTCAT panel or the JTCAT popout to be actively
// capturing audio via getUserMedia, which broke when the phone
// drove JTCAT without a desktop renderer in the loop. K3SBP
// 2026-05-31.
//
// Reads samples directly from the FT8 engine's audio buffer
// (12 kHz mono Float32) and emits 0..255 byte bins for the
// 0..3000 Hz FT8 passband — same shape the renderer used to
// broadcast, so the existing on-the-wire protocol and mobile
// renderer don't change.

'use strict';

const FFT_SIZE = 2048;          // 2 × FFT_SIZE samples is 341 ms @ 12 kHz
const SAMPLE_RATE = 12000;
const PASSBAND_HZ = 3000;

/** Pre-computed Hann window for FFT_SIZE. Windowing reduces sidelobes
 *  so a strong signal at one offset doesn't smear across the whole
 *  spectrum. */
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
}

/** Pre-computed bit-reversal permutation for radix-2 FFT. */
const BITREV = new Uint32Array(FFT_SIZE);
{
  const logN = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let rev = 0;
    let n = i;
    for (let j = 0; j < logN; j++) {
      rev = (rev << 1) | (n & 1);
      n >>= 1;
    }
    BITREV[i] = rev;
  }
}

/** Pre-computed cosine/sine tables for FFT twiddles. */
const COS = new Float32Array(FFT_SIZE / 2);
const SIN = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  COS[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  SIN[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}

/** Reusable scratch buffers — avoid allocating on every FFT call. */
const RE = new Float32Array(FFT_SIZE);
const IM = new Float32Array(FFT_SIZE);

/** Run an in-place radix-2 Cooley-Tukey FFT on RE/IM. */
function fftInPlace() {
  // Bit-reverse permutation
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = BITREV[i];
    if (j > i) {
      let t = RE[i]; RE[i] = RE[j]; RE[j] = t;
      t = IM[i]; IM[i] = IM[j]; IM[j] = t;
    }
  }
  // Butterflies
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const tableStep = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      let k = 0;
      for (let j = i; j < i + half; j++) {
        const tre = RE[j + half] * COS[k] - IM[j + half] * SIN[k];
        const tim = RE[j + half] * SIN[k] + IM[j + half] * COS[k];
        RE[j + half] = RE[j] - tre;
        IM[j + half] = IM[j] - tim;
        RE[j] += tre;
        IM[j] += tim;
        k += tableStep;
      }
    }
  }
}

/** Compute spectrum bins from a 12 kHz Float32 audio buffer.
 *
 * Pulls the last FFT_SIZE samples (must be at least FFT_SIZE
 * available), windows with Hann, runs FFT, returns the magnitude
 * spectrum scaled to 0..255 bytes covering the 0..3000 Hz passband.
 *
 * @param {Float32Array} audioBuffer - circular or linear 12kHz mono
 * @param {number} audioOffset - write-cursor position (1 past newest sample)
 * @param {number} binCount - number of output bins to produce (passband)
 * @returns {Uint8Array} bins of length binCount, 0..255
 */
function computeSpectrumBins(audioBuffer, audioOffset, binCount) {
  if (!audioBuffer || audioBuffer.length < FFT_SIZE || binCount <= 0) {
    return new Uint8Array(binCount);
  }
  // Pull last FFT_SIZE samples ending at audioOffset (circular).
  const bufLen = audioBuffer.length;
  let start = audioOffset - FFT_SIZE;
  while (start < 0) start += bufLen;
  for (let i = 0; i < FFT_SIZE; i++) {
    RE[i] = audioBuffer[(start + i) % bufLen] * HANN[i];
    IM[i] = 0;
  }
  fftInPlace();

  // Magnitude spectrum — only need 0..3000 Hz worth of bins.
  //   binHz = SAMPLE_RATE / FFT_SIZE  (= 5.86 Hz @ 12kHz / 2048)
  //   passbandBins (in FFT terms) = PASSBAND_HZ / binHz ≈ 512
  const passbandFftBins = Math.floor((PASSBAND_HZ / SAMPLE_RATE) * FFT_SIZE);
  // Build magnitude in dB so the byte range maps to a useful dynamic
  // range. AnalyserNode's getByteFrequencyData uses dB scaling with
  // defaultMinDecibels=-100 and defaultMaxDecibels=-30 — replicate
  // that so the existing renderer-side gradient/auto-stretch reads
  // the same on-the-wire values.
  const MIN_DB = -100;
  const MAX_DB = -30;
  const out = new Uint8Array(binCount);
  for (let i = 0; i < binCount; i++) {
    // Re-sample passband down to binCount output slots (peak within window).
    const lo = Math.floor((i * passbandFftBins) / binCount);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) * passbandFftBins) / binCount));
    let peak = 0;
    for (let k = lo; k < hi && k < passbandFftBins; k++) {
      // Magnitude = sqrt(re^2 + im^2). Use squared form to skip the sqrt
      // and take log10 of magnitude-squared / 2 instead. Skip-square keeps
      // the per-bin loop tight.
      const mag2 = RE[k] * RE[k] + IM[k] * IM[k];
      if (mag2 > peak) peak = mag2;
    }
    // Convert magnitude-squared to dB. Normalize by FFT_SIZE so the
    // dB scale is independent of FFT length. 1e-12 floor prevents
    // log10(0) → -Infinity.
    const db = 10 * Math.log10(peak / (FFT_SIZE * FFT_SIZE) + 1e-12);
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    out[i] = Math.round(((clamped - MIN_DB) / (MAX_DB - MIN_DB)) * 255);
  }
  return out;
}

module.exports = { computeSpectrumBins, FFT_SIZE };
