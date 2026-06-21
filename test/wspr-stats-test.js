#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// WSPR stats regression. Run: node test/wspr-stats-test.js

const assert = require('assert');
const { computeWsprStats, dbmToWatts, formatMpw } = require('../lib/wspr/stats');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const SPOTS = [
  { call: 'VK7JJ', grid: 'QE37', dBm: 23, snr: -24, distanceMi: 10500, bearing: 250, entity: 'Australia', continent: 'OC' },
  { call: 'G4ABC', grid: 'IO80', dBm: 37, snr: -7, distanceMi: 3500, bearing: 45, entity: 'England', continent: 'EU' },
  { call: 'W1AW', grid: 'FN31', dBm: 30, snr: -12, distanceMi: 120, bearing: 80, entity: 'United States', continent: 'NA' },
  { call: 'VK7JJ', grid: 'QE37', dBm: 23, snr: -22, distanceMi: 10500, bearing: 250, entity: 'Australia', continent: 'OC' }, // dup call
];

check('dbmToWatts: 30 dBm = 1 W, 23 = 0.2 W, 0 = 1 mW', () => {
  assert.ok(Math.abs(dbmToWatts(30) - 1) < 1e-9);
  assert.ok(Math.abs(dbmToWatts(23) - 0.1995) < 1e-3);
  assert.ok(Math.abs(dbmToWatts(0) - 0.001) < 1e-6);
});

check('counts uniques (calls/grids/entities/continents)', () => {
  const s = computeWsprStats(SPOTS);
  assert.strictEqual(s.spots, 4);
  assert.strictEqual(s.uniqueCalls, 3);      // VK7JJ once
  assert.strictEqual(s.uniqueEntities, 3);
  assert.strictEqual(s.uniqueContinents, 3); // OC, EU, NA
});

check('bestDx = farthest spot', () => {
  const s = computeWsprStats(SPOTS);
  assert.strictEqual(s.bestDx.call, 'VK7JJ');
  assert.strictEqual(s.bestDx.distanceMi, 10500);
  assert.strictEqual(s.bestDx.entity, 'Australia');
});

check('bestMpw = best distance-per-watt (QRPp headline)', () => {
  const s = computeWsprStats(SPOTS);
  // VK7JJ 10500 mi @ 23 dBm (0.2 W) = ~52600 mi/W beats G4ABC 3500/5W=700.
  assert.strictEqual(s.bestMpw.call, 'VK7JJ');
  assert.ok(s.bestMpw.milesPerWatt > 50000);
});

check('SNR stats: avg / best / weakest', () => {
  const s = computeWsprStats(SPOTS);
  assert.strictEqual(s.snrBest, -7);       // G4ABC strongest
  assert.strictEqual(s.weakest.call, 'VK7JJ');
  assert.strictEqual(s.weakest.snr, -24);  // deepest dig
  assert.strictEqual(s.snrAvg, Math.round((-24 - 7 - 12 - 22) / 4));
});

check('empty / null input -> zeroed stats, no throw', () => {
  for (const v of [[], null, undefined]) {
    const s = computeWsprStats(v);
    assert.strictEqual(s.spots, 0);
    assert.strictEqual(s.bestDx, null);
    assert.strictEqual(s.bestMpw, null);
    assert.strictEqual(s.snrAvg, null);
  }
});

check('tolerates spots missing distance/dBm/snr', () => {
  const s = computeWsprStats([{ call: 'K1ABC' }, { call: 'W2XYZ', snr: -15 }]);
  assert.strictEqual(s.spots, 2);
  assert.strictEqual(s.uniqueCalls, 2);
  assert.strictEqual(s.bestDx, null);
  assert.strictEqual(s.snrBest, -15);
});

check('formatMpw compacts thousands', () => {
  assert.strictEqual(formatMpw(11200), '11.2k mi/W');
  assert.strictEqual(formatMpw(700), '700 mi/W');
  assert.strictEqual(formatMpw(null), '');
});

console.log(`\nWSPR stats: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
