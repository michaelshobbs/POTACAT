#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
//
// WSPR band table + wsprnet upload formatter tests.
// Run: node test/wspr-network-test.js
// Network is injected (fake fetch) — nothing here touches the wire.

const assert = require('assert');
const B = require('../lib/wspr/bands');
const N = require('../lib/wspr/wsprnet');

let pass = 0, fail = 0;
const _checks = [];
function check(name, fn) { _checks.push([name, fn]); }

// ---- bands -------------------------------------------------------------
check('dialForBand returns the standard WSPR dials', () => {
  assert.strictEqual(B.dialForBand('20m'), 14.0956);
  assert.strictEqual(B.dialForBand('40m'), 7.0386);
  assert.strictEqual(B.dialForBand('30m'), 10.1387);
  assert.strictEqual(B.dialForBand('nonsense'), null);
});

check('every band entry is unique and ascending in frequency', () => {
  const f = B.WSPR_BANDS.map((b) => b.dialMHz);
  for (let i = 1; i < f.length; i++) assert.ok(f[i] > f[i - 1], `not ascending at ${i}`);
  assert.strictEqual(new Set(B.WSPR_BANDS.map((b) => b.band)).size, B.WSPR_BANDS.length);
});

check('bandForFreq resolves dial and in-passband frequencies', () => {
  assert.strictEqual(B.bandForFreq(14.0956).band, '20m');     // exact dial
  assert.strictEqual(B.bandForFreq(14.097).band, '20m');      // dial + ~1.4 kHz
  assert.strictEqual(B.bandForFreq(7.0386).band, '40m');
  assert.strictEqual(B.bandForFreq(146.0), null);             // nothing near
});

check('txFreqMHz adds the audio offset', () => {
  assert.ok(Math.abs(B.txFreqMHz(14.0956, 1500) - 14.0971) < 1e-9);
  assert.ok(Math.abs(B.txFreqMHz(7.0386, 1400) - 7.04) < 1e-9);
});

// ---- wsprnet param building -------------------------------------------
const RX = { call: 'K3SBP', grid: 'FN20' };
const SPOT = { timeUtc: '2148', snr: -7, dt: 0.3, freqMHz: 7.04003, drift: 0, call: 'G4ABC', grid: 'IO80', dBm: 37 };

check('buildSpotParams maps decoder + rx into wsprnet fields', () => {
  const p = N.buildSpotParams(SPOT, RX, { dialMHz: 7.0386, dateYYMMDD: '260619' });
  assert.strictEqual(p.function, 'wspr');
  assert.strictEqual(p.rcall, 'K3SBP');
  assert.strictEqual(p.rgrid, 'FN20');
  assert.strictEqual(p.rqrg, '7.038600');
  assert.strictEqual(p.date, '260619');
  assert.strictEqual(p.time, '2148');
  assert.strictEqual(p.sig, '-7');
  assert.strictEqual(p.dt, '0.3');
  assert.strictEqual(p.tqrg, '7.040030');
  assert.strictEqual(p.tcall, 'G4ABC');
  assert.strictEqual(p.tgrid, 'IO80');
  assert.strictEqual(p.dbm, '37');
  assert.strictEqual(p.mode, '2');
});

check('buildSpotParams returns null for unreportable / incomplete spots', () => {
  assert.strictEqual(N.buildSpotParams({ ...SPOT, grid: null }, RX, { dialMHz: 7.0386, dateYYMMDD: '260619' }), null);
  assert.strictEqual(N.buildSpotParams(SPOT, { call: 'K3SBP' }, { dialMHz: 7.0386, dateYYMMDD: '260619' }), null); // rx grid missing
  assert.strictEqual(N.buildSpotParams(SPOT, RX, { dateYYMMDD: '260619' }), null); // dial missing
  assert.strictEqual(N.buildSpotParams(SPOT, RX, { dialMHz: 7.0386 }), null); // date missing
});

check('buildPostUrl produces an encoded query string', () => {
  const url = N.buildPostUrl({ function: 'wspr', rcall: 'K3SBP', sig: '-7' });
  assert.ok(url.startsWith('http://wsprnet.org/post?'));
  assert.ok(url.includes('function=wspr'));
  assert.ok(url.includes('rcall=K3SBP'));
  assert.ok(url.includes('sig=-7'));
});

check('utcStamp formats YYMMDD / HHMM in UTC', () => {
  const { dateYYMMDD, timeHHMM } = N.utcStamp(Date.UTC(2026, 5, 19, 21, 48, 30)); // 2026-06-19 21:48 UTC
  assert.strictEqual(dateYYMMDD, '260619');
  assert.strictEqual(timeHHMM, '2148');
});

// ---- upload with injected fetch ---------------------------------------
check('uploadSpot calls fetch with the built URL and reports ok', async () => {
  let calledUrl = null;
  const fakeFetch = async (url) => { calledUrl = url; return { ok: true, status: 200 }; };
  const r = await N.uploadSpot(SPOT, RX, { dialMHz: 7.0386, dateYYMMDD: '260619', fetch: fakeFetch });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 200);
  assert.ok(calledUrl.includes('tcall=G4ABC') && calledUrl.includes('rcall=K3SBP'));
});

check('uploadSpot skips unreportable spots without fetching', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true }; };
  const r = await N.uploadSpot({ ...SPOT, call: null }, RX, { dialMHz: 7.0386, dateYYMMDD: '260619', fetch: fakeFetch });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(called, false);
});

check('uploadSpots summarizes uploaded / skipped / failed', async () => {
  const spots = [
    SPOT,                                   // ok
    { ...SPOT, call: null },                // skipped (hashed)
    { ...SPOT, call: 'W1AW', grid: 'FN31' },// will fail (fetch throws)
  ];
  let n = 0;
  const fakeFetch = async () => { n++; if (n === 2) throw new Error('net down'); return { ok: true, status: 200 }; };
  const r = await N.uploadSpots(spots, RX, { dialMHz: 7.0386, dateYYMMDD: '260619', fetch: fakeFetch });
  assert.strictEqual(r.uploaded, 1);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(r.failed, 1);
});

// Run registered checks in order, awaiting any that are async.
(async () => {
  for (const [name, fn] of _checks) {
    try { await fn(); pass++; console.log(`  ok  ${name}`); }
    catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\nWSPR network/bands: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
