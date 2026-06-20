// SPDX-License-Identifier: Apache-2.0
// Copyright 2024-2026 Casey Stanton
//
// Standard WSPR dial frequencies and sub-band geometry. Pure data + lookups.
//
// WSPR lives in a narrow 200 Hz sub-band sitting 1400–1600 Hz ABOVE a fixed USB
// dial frequency. The radio is tuned to the DIAL (USB); transmitted/received
// RF = dial + audioHz. These are the long-established WSPR dial frequencies
// (MHz) coordinated on wsprnet.org.

// audioLoHz..audioHiHz is the 200 Hz WSPR window within the SSB passband.
const AUDIO_LO_HZ = 1400;
const AUDIO_HI_HZ = 1600;
const AUDIO_CENTER_HZ = 1500;

// name -> USB dial frequency in MHz.
const WSPR_BANDS = [
  { band: '2200m', dialMHz: 0.136000 },
  { band: '630m',  dialMHz: 0.474200 },
  { band: '160m',  dialMHz: 1.836600 },
  { band: '80m',   dialMHz: 3.568600 },
  { band: '60m',   dialMHz: 5.287200 },
  { band: '40m',   dialMHz: 7.038600 },
  { band: '30m',   dialMHz: 10.138700 },
  { band: '20m',   dialMHz: 14.095600 },
  { band: '17m',   dialMHz: 18.104600 },
  { band: '15m',   dialMHz: 21.094600 },
  { band: '12m',   dialMHz: 24.924600 },
  { band: '10m',   dialMHz: 28.124600 },
  { band: '6m',    dialMHz: 50.293000 },
  { band: '2m',    dialMHz: 144.489000 },
];

const _byBand = new Map(WSPR_BANDS.map((b) => [b.band, b]));

/** Dial frequency (MHz) for a band name, or null. */
function dialForBand(band) {
  const e = _byBand.get(String(band));
  return e ? e.dialMHz : null;
}

/**
 * Nearest WSPR band for an arbitrary frequency (MHz) — matches when the freq is
 * within the dial..dial+passband region (a little tolerance each side). Returns
 * the band entry or null. Lets main.js label a tuned freq or pick the sub-band.
 */
function bandForFreq(mhz) {
  const f = Number(mhz);
  if (!Number.isFinite(f)) return null;
  let best = null, bestDelta = Infinity;
  for (const e of WSPR_BANDS) {
    // Allow the dial itself plus the ~2.5 kHz SSB passband above it, with a
    // small guard band, so a dial or an in-passband freq both resolve.
    const delta = Math.abs(f - e.dialMHz);
    if (f >= e.dialMHz - 0.0005 && f <= e.dialMHz + 0.0030 && delta < bestDelta) {
      best = e; bestDelta = delta;
    }
  }
  return best;
}

/** Transmit RF (MHz) for a dial + audio offset (Hz within the 200 Hz window). */
function txFreqMHz(dialMHz, audioHz = AUDIO_CENTER_HZ) {
  return Number(dialMHz) + Number(audioHz) / 1e6;
}

module.exports = {
  WSPR_BANDS,
  dialForBand,
  bandForFreq,
  txFreqMHz,
  AUDIO_LO_HZ,
  AUDIO_HI_HZ,
  AUDIO_CENTER_HZ,
};
