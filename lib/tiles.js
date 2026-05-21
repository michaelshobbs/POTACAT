'use strict';
//
// Tiles on the Air — spot fetcher.
//
// API: https://icneuzxitdqtofutxbla.supabase.co/functions/v1/spots
//   - With no `since` parameter the endpoint returns a full snapshot of the
//     currently-active spots (last 30 minutes, matches tilesontheair.com).
//   - POTACAT polls that snapshot and replaces its local Tiles list with the
//     response (the same pattern as the POTA API). It deliberately does NOT
//     use `since`: that endpoint treats `since` as a hard cutoff, so a spot
//     ages out of incremental responses within seconds and the UI drops it.
//   - main.js rate-limits the poll to once per ~20 s — the tilesontheair.com
//     operator foots the Supabase bill, so POTACAT stays polite regardless of
//     the user's spot-refresh interval. (KK4ODA, 2026-05-21.)
//   - Spots auto-expire 30 minutes after creation.
//   - Server-side QRT filter: spots whose notes contain the word "qrt"
//     (whole word, case-insensitive) are dropped before they reach us.
//   - Other filters: active_hours (decimals OK, max 168), call_sign, limit
//     (max 200).
//
// Activation reference is the spot's maidenhead grid square — there's no
// separate "tile id." A spot can also carry pota_ref / sota_ref for
// activations that overlap multiple programs.
//

const https = require('https');

const HOST = 'icneuzxitdqtofutxbla.supabase.co';
const PATH = '/functions/v1/spots';
const API_KEY = 'f8c97c8c-88b9-48da-a68c-e8d52c23a042';

/**
 * Fetch the current Tiles spot snapshot (the endpoint's default 30-minute
 * active window). Resolves to the raw `spots[]` array; the caller replaces
 * its local Tiles list with it and maps each spot into POTACAT's spot shape.
 */
function fetchSpots(opts = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    // Limit cap is 200 server-side; pick something a bit under.
    params.set('limit', String(opts.limit || 150));
    // No `since` — always fetch the full active snapshot (see header).
    if (opts.activeHours) params.set('active_hours', String(opts.activeHours));
    if (opts.callSign) params.set('call_sign', String(opts.callSign).toUpperCase());

    const req = https.request({
      host: HOST,
      path: `${PATH}?${params.toString()}`,
      method: 'GET',
      headers: {
        'x-api-key': API_KEY,
        'User-Agent': 'POTACAT/1.6',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Tiles API ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          const parsed = JSON.parse(data);
          resolve(Array.isArray(parsed.spots) ? parsed.spots : []);
        } catch (err) {
          reject(new Error(`Tiles API parse failed: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Tiles API timeout')); });
    req.end();
  });
}

/**
 * Parse a Tiles frequency string into kHz.
 *
 * The API delivers `frequency` as a string in MHz, but real-world values
 * include malformed entries like "14.310.5" (the spotter inserted a stray
 * dot; the intended value was 14310.5 kHz / 14.3105 MHz). Strip extra dots
 * defensively, parse as MHz, return kHz as a number. Returns 0 for
 * unparseable inputs.
 */
function parseFreqKhz(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  // Keep only digits and the first dot.
  let seenDot = false;
  let cleaned = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') cleaned += ch;
    else if (ch === '.' && !seenDot) { cleaned += ch; seenDot = true; }
    // otherwise: skip (treats further dots / commas / letters as noise)
  }
  const mhz = parseFloat(cleaned);
  if (!isFinite(mhz) || mhz <= 0) return 0;
  return Math.round(mhz * 1000 * 10) / 10; // kHz with 100 Hz precision
}

module.exports = { fetchSpots, parseFreqKhz };
