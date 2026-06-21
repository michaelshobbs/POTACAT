// SPDX-License-Identifier: Apache-2.0
// Copyright 2024-2026 Casey Stanton
//
// "Where am I heard" — pull reception reports for OUR beacon from wspr.live, the
// community ClickHouse mirror of wsprnet with a clean SQL-over-HTTP API (what
// every WSPR analysis tool uses). This is the payoff of running a beacon: the
// live map of who's decoding you, how far, at what SNR.
//
// We query the host-side (main process), not the renderer, so there's no CSP
// concern. Parsing is pure + injected-fetch tested; the network call is real
// only in production.

const WSPRLIVE_URL = 'https://db1.wspr.live/';

/**
 * Build the wspr.live query URL for reports of `call` as the TRANSMITTER.
 * wspr.rx columns: time, rx_sign, rx_loc, rx_lat, rx_lon, snr, power (dBm),
 * distance (km), azimuth, frequency (Hz). FORMAT JSON returns { data: [...] }.
 */
function buildReceptionUrl(call, opts = {}) {
  const c = String(call || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
  if (!c) return null;
  const minutes = Math.max(1, Math.min(1440, opts.sinceMinutes || 120));
  const limit = Math.max(1, Math.min(1000, opts.limit || 300));
  const sql =
    'SELECT time, rx_sign, rx_loc, rx_lat, rx_lon, snr, power, distance, azimuth, frequency ' +
    `FROM wspr.rx WHERE tx_sign = '${c}' AND time > subtractMinutes(now(), ${minutes}) ` +
    `ORDER BY time DESC LIMIT ${limit} FORMAT JSON`;
  return (opts.baseUrl || WSPRLIVE_URL) + '?query=' + encodeURIComponent(sql);
}

/**
 * Parse a wspr.live FORMAT JSON response into normalized reception reports.
 * Tolerant: bad rows are skipped, not thrown. Distance is converted km->mi.
 * @returns {Array<{timeUtc,rxCall,rxGrid,lat,lon,snr,dBm,distanceMi,bearing,freqMHz}>}
 */
function parseReception(text) {
  let obj;
  try { obj = typeof text === 'string' ? JSON.parse(text) : text; } catch { return []; }
  const rows = obj && Array.isArray(obj.data) ? obj.data : Array.isArray(obj) ? obj : [];
  const out = [];
  for (const r of rows) {
    if (!r || !r.rx_sign) continue;
    const lat = num(r.rx_lat), lon = num(r.rx_lon);
    const distKm = num(r.distance);
    out.push({
      timeUtc: r.time != null ? String(r.time) : null,
      rxCall: String(r.rx_sign).toUpperCase(),
      rxGrid: r.rx_loc ? String(r.rx_loc).toUpperCase() : null,
      lat: lat, lon: lon,
      snr: int(r.snr),
      dBm: int(r.power),
      distanceMi: distKm != null ? Math.round(distKm * 0.621371) : null,
      bearing: int(r.azimuth),
      freqMHz: r.frequency != null ? num(r.frequency) / 1e6 : null,
    });
  }
  return out;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }

/**
 * Fetch reception reports for `call`. Network is injected via opts.fetch
 * (defaults to global fetch in Electron main / Node 22+).
 * @returns {Promise<{ok:boolean, reports:Array, error?:string}>}
 */
async function fetchReception(call, opts = {}) {
  const url = buildReceptionUrl(call, opts);
  if (!url) return { ok: false, reports: [], error: 'no callsign' };
  const doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return { ok: false, reports: [], error: 'no fetch available' };
  try {
    const res = await doFetch(url, { method: 'GET' });
    if (res && res.ok === false) return { ok: false, reports: [], error: `http ${res.status}` };
    const text = typeof res.text === 'function' ? await res.text() : res;
    return { ok: true, reports: parseReception(text) };
  } catch (e) {
    return { ok: false, reports: [], error: String((e && e.message) || e) };
  }
}

module.exports = { buildReceptionUrl, parseReception, fetchReception, WSPRLIVE_URL };
