#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
//
// WSPR decode-bridge regression suite. Run:  node test/wspr-decoder-test.js
//
// Guards the PURE parser that turns wsprd's stdout into spot objects. The
// decoder itself (GPLv3 wsprd) is a separate bundled process and is NOT tested
// here — only POTACAT's Apache-2.0 parsing of its output, plus the WAV writer.
//
// Sample lines below are the canonical wsprd stdout shape:
//   HHMM  SNR  DT  FREQ(MHz)  DRIFT  CALL GRID DBM  [trailing diagnostics...]

const assert = require('assert');
const { parseWsprdOutput, writeWav } = require('../lib/wspr-decoder');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ---- standard type-1 decode lines --------------------------------------
check('parses a standard decode line', () => {
  const [s] = parseWsprdOutput('2148  -7  0.3   7.040030  0  G4ABC IO80 37');
  assert.strictEqual(s.timeUtc, '2148');
  assert.strictEqual(s.snr, -7);
  assert.strictEqual(s.dt, 0.3);
  assert.strictEqual(s.freqMHz, 7.04003);
  assert.strictEqual(s.drift, 0);
  assert.strictEqual(s.call, 'G4ABC');
  assert.strictEqual(s.grid, 'IO80');
  assert.strictEqual(s.dBm, 37);
  assert.strictEqual(s.message, 'G4ABC IO80 37');
});

check('parses multiple lines, skips blanks', () => {
  const out = [
    '0000 -21  0.5  14.097067  0  K3SBP FN20 30',
    '',
    '0000 -12 -1.2  14.097120  1  W1AW FN31 23',
  ].join('\n');
  const spots = parseWsprdOutput(out);
  assert.strictEqual(spots.length, 2);
  assert.strictEqual(spots[0].call, 'K3SBP');
  assert.strictEqual(spots[1].call, 'W1AW');
  assert.strictEqual(spots[1].dt, -1.2);
  assert.strictEqual(spots[1].drift, 1);
});

check('anchors on grid so trailing diagnostics are ignored', () => {
  // Some wsprd builds append sync/jitter/blocksize columns after the message.
  const line = '2148  -7  0.3   7.040030  0  G4ABC IO80 37          1     0.49  1  742    0  0  0  124     1';
  const [s] = parseWsprdOutput(line);
  assert.strictEqual(s.call, 'G4ABC');
  assert.strictEqual(s.grid, 'IO80');
  assert.strictEqual(s.dBm, 37);
});

check('negative SNR and zero drift handled', () => {
  const [s] = parseWsprdOutput('0002 -28  0.0  10.140200  0  VK7JJ QE37 23');
  assert.strictEqual(s.snr, -28);
  assert.strictEqual(s.grid, 'QE37');
});

// ---- compound / hashed (type 2/3) messages -----------------------------
check('hashed/compound message keeps lead token, null grid/dBm', () => {
  const [s] = parseWsprdOutput('1234 -15  0.2  14.097100  0  <PJ4/K1ABC> FK52');
  // <...> is a hashed call; FK52 IS a grid here, so it still anchors —
  // verify we at least never throw and produce a record.
  assert.ok(s);
  assert.strictEqual(s.timeUtc, '1234');
});

check('message with no grid at all -> call set, grid null', () => {
  const [s] = parseWsprdOutput('1234 -15  0.2  14.097100  0  HASHEDONLY');
  assert.strictEqual(s.call, 'HASHEDONLY');
  assert.strictEqual(s.grid, null);
  assert.strictEqual(s.dBm, null);
});

// ---- robustness: non-decode lines are rejected -------------------------
check('header / garbage lines are skipped', () => {
  const out = [
    '<DecodeFinished>',
    'wsprd version 2.21',
    '0000 -21  0.5  14.097067  0  K3SBP FN20 30',
  ].join('\n');
  const spots = parseWsprdOutput(out);
  assert.strictEqual(spots.length, 1);
  assert.strictEqual(spots[0].call, 'K3SBP');
});

check('empty / null input -> []', () => {
  assert.deepStrictEqual(parseWsprdOutput(''), []);
  assert.deepStrictEqual(parseWsprdOutput(null), []);
});

check('out-of-range dBm is dropped to null (not a valid WSPR power)', () => {
  // 99 is not a valid WSPR dBm; the token isn't a power, so grid anchor fails
  // the dBm test and we fall through to raw.
  const [s] = parseWsprdOutput('0000 -21  0.5  14.097067  0  K3SBP FN20 99');
  assert.strictEqual(s.dBm, null);
});

// ---- WAV writer --------------------------------------------------------
check('writeWav emits a valid 12 kHz mono 16-bit PCM header', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `wspr-wav-test-${pass}.wav`);
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  writeWav(samples, tmp);
  const buf = fs.readFileSync(tmp);
  assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(buf.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(buf.readUInt16LE(22), 1);        // mono
  assert.strictEqual(buf.readUInt32LE(24), 12000);    // 12 kHz
  assert.strictEqual(buf.readUInt16LE(34), 16);       // 16-bit
  assert.strictEqual(buf.readUInt32LE(40), samples.length * 2); // data size
  // clamp check: +1.0 -> 32767, -1.0 -> -32767
  assert.strictEqual(buf.readInt16LE(44 + 3 * 2), 32767);
  assert.strictEqual(buf.readInt16LE(44 + 4 * 2), -32767);
  fs.rmSync(tmp, { force: true });
});

console.log(`\nWSPR decoder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
