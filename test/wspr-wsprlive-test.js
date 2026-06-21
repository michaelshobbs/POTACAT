#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// "Where am I heard" (wspr.live) regression. Run: node test/wspr-wsprlive-test.js
// Network injected — nothing here touches the wire.

const assert = require('assert');
const W = require('../lib/wspr/wsprlive');

let pass = 0, fail = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

// Sample wspr.live FORMAT JSON response (trimmed to the columns we select).
const SAMPLE = JSON.stringify({
  meta: [{ name: 'time' }],
  data: [
    { time: '2026-06-20 13:50:00', rx_sign: 'EA8BFK', rx_loc: 'IL18', rx_lat: 28.0, rx_lon: -15.4, snr: -21, power: 30, distance: 4800, azimuth: 95, frequency: 14097100 },
    { time: '2026-06-20 13:48:00', rx_sign: 'VK7JJ', rx_loc: 'QE37', rx_lat: -41.2, rx_lon: 147.1, snr: -26, power: 30, distance: 17000, azimuth: 250, frequency: 14097090 },
    { time: '2026-06-20 13:48:00', rx_sign: '', rx_loc: 'XX00' }, // junk row — skipped
  ],
  rows: 3,
});

check('buildReceptionUrl: encodes tx_sign + window + limit', () => {
  const u = W.buildReceptionUrl('k3sbp', { sinceMinutes: 60, limit: 100 });
  assert.ok(u.startsWith('https://db1.wspr.live/?query='));
  const q = decodeURIComponent(u.split('query=')[1]);
  assert.ok(q.includes("tx_sign = 'K3SBP'"), 'uppercased call in WHERE');
  assert.ok(q.includes('subtractMinutes(now(), 60)'));
  assert.ok(q.includes('LIMIT 100'));
  assert.ok(q.includes('FORMAT JSON'));
});

check('buildReceptionUrl: clamps window + limit, sanitizes call (no injection)', () => {
  const u = W.buildReceptionUrl("K3'; DROP--", { sinceMinutes: 99999, limit: 99999 });
  const q = decodeURIComponent(u.split('query=')[1]);
  // The injection chars (quote/semicolon/space/dash) are stripped; the call is
  // safely contained in the string literal — the quote can't break out.
  assert.ok(q.includes("tx_sign = 'K3DROP'"), 'call sanitized to alnum, safely quoted');
  assert.ok(!/tx_sign = 'K3'/.test(q), 'no quote-breakout');
  assert.ok(q.includes('subtractMinutes(now(), 1440)'), 'window clamped to 1440');
  assert.ok(q.includes('LIMIT 1000'), 'limit clamped to 1000');
});

check('buildReceptionUrl: empty call -> null', () => {
  assert.strictEqual(W.buildReceptionUrl(''), null);
  assert.strictEqual(W.buildReceptionUrl('!!!'), null);
});

check('parseReception: maps rows, km->mi, skips junk', () => {
  const r = W.parseReception(SAMPLE);
  assert.strictEqual(r.length, 2); // junk row dropped
  assert.strictEqual(r[0].rxCall, 'EA8BFK');
  assert.strictEqual(r[0].rxGrid, 'IL18');
  assert.strictEqual(r[0].snr, -21);
  assert.strictEqual(r[0].dBm, 30);
  assert.strictEqual(r[0].distanceMi, Math.round(4800 * 0.621371)); // 2983
  assert.strictEqual(r[0].bearing, 95);
  assert.ok(Math.abs(r[0].freqMHz - 14.0971) < 1e-6);
  assert.strictEqual(r[0].lat, 28.0);
});

check('parseReception: bad JSON / empty -> []', () => {
  assert.deepStrictEqual(W.parseReception('not json'), []);
  assert.deepStrictEqual(W.parseReception(''), []);
  assert.deepStrictEqual(W.parseReception('{"data":[]}'), []);
});

check('parseReception: accepts a bare array too', () => {
  const r = W.parseReception([{ rx_sign: 'W1AW', distance: 100 }]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].rxCall, 'W1AW');
});

check('fetchReception: uses injected fetch + parses (res.text())', async () => {
  let calledUrl = null;
  const fakeFetch = async (url) => { calledUrl = url; return { ok: true, status: 200, text: async () => SAMPLE }; };
  const out = await W.fetchReception('K3SBP', { fetch: fakeFetch });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.reports.length, 2);
  assert.ok(calledUrl.includes("tx_sign"));
});

check('fetchReception: http error surfaced', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503 });
  const out = await W.fetchReception('K3SBP', { fetch: fakeFetch });
  assert.strictEqual(out.ok, false);
  assert.ok(out.error.includes('503'));
});

check('fetchReception: no callsign -> error, no fetch', async () => {
  let called = false;
  const out = await W.fetchReception('', { fetch: async () => { called = true; return {}; } });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(called, false);
});

(async () => {
  for (const [name, fn] of checks) {
    try { await fn(); pass++; console.log(`  ok  ${name}`); }
    catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\nWSPR where-am-I-heard: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
