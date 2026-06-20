// SPDX-License-Identifier: Apache-2.0
// Copyright 2024-2026 Casey Stanton
//
// WSPR decode bridge — the Apache-2.0 side of the WSPR feature.
//
// LICENSE FIREWALL: The actual WSPR decoder (`wsprd`, GPLv3, by K1JT/K9AN and
// the WSJT Development Group) is NOT linked into POTACAT. It ships as a separate
// standalone executable under third_party/wsprd/ and is invoked here over a
// child process — captured audio goes in as a temp .wav, decode lines come back
// on stdout. That process boundary is "mere aggregation" under the GPL: POTACAT
// stays Apache-2.0; wsprd stays GPLv3; the two coexist without either touching
// the other's license. Do NOT replace this with a native addon / require() of
// wsprd code — that would link GPLv3 into POTACAT and relicense the whole app.
//
// wsprd reads a 2-minute, 12 kHz, mono recording (the same rate the JTCAT engine
// already captures) and prints one line per decode:
//
//   HHMM  SNR  DT   FREQ(MHz)  DRIFT  CALL GRID DBM   [trailing diagnostics...]
//
// e.g.  2148  -7  0.3   7.040030  0  G4ABC IO80 37
//
// parseWsprdOutput() is the pure, testable heart; decodeWspr() does the I/O.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SAMPLE_RATE = 12000;

// Maidenhead 4-char grid: field A-R, field A-R, square 0-9, square 0-9.
const GRID4_RE = /^[A-R][A-R][0-9][0-9]$/;

/**
 * Parse wsprd's stdout into structured spots. PURE — no I/O, fully unit-tested.
 *
 * Each decode line begins with five fixed numeric columns
 *   [0] time HHMM   [1] SNR dB   [2] DT s   [3] freq MHz   [4] drift Hz/min
 * followed by the message. For a standard type-1 message that's
 *   CALL  GRID4  DBM
 * We anchor on the GRID4 token so trailing diagnostic columns (which some wsprd
 * builds append) don't confuse the parse. Compound/hashed (type 2/3) messages
 * have no plain GRID4 — we keep call+raw and leave grid/dBm null.
 *
 * @param {string} stdout  raw wsprd stdout
 * @returns {Array<{timeUtc,snr,dt,freqMHz,drift,call,grid,dBm,message,raw}>}
 */
function parseWsprdOutput(stdout) {
  if (!stdout) return [];
  const spots = [];
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tok = line.split(/\s+/);
    if (tok.length < 6) continue;

    // First five columns must be numeric or this isn't a decode line
    // (wsprd also emits headers/blank lines we want to skip).
    const time = tok[0];
    const snr = Number(tok[1]);
    const dt = Number(tok[2]);
    const freqMHz = Number(tok[3]);
    const drift = Number(tok[4]);
    if (!/^\d{3,4}$/.test(time)) continue;
    if (![snr, dt, freqMHz, drift].every(Number.isFinite)) continue;
    if (freqMHz <= 0 || freqMHz > 30000) continue; // sane HF/VHF MHz guard

    // Message = everything after the 5 numeric columns, minus trailing
    // diagnostics. Anchor on a 4-char grid token to find the standard shape.
    const msgTokens = tok.slice(5);
    let call = null, grid = null, dBm = null;
    const gi = msgTokens.findIndex((t) => GRID4_RE.test(t));
    if (gi >= 1 && /^-?\d{1,3}$/.test(msgTokens[gi + 1] || '')) {
      call = msgTokens[gi - 1];
      grid = msgTokens[gi];
      dBm = Number(msgTokens[gi + 1]);
      if (!(dBm >= 0 && dBm <= 60)) { dBm = null; } // valid WSPR dBm range
    } else {
      // Hashed/compound call (type 2/3) — no plain grid. Keep the lead token.
      call = msgTokens[0] || null;
    }

    const message = call && grid && dBm != null
      ? `${call} ${grid} ${dBm}`
      : msgTokens.join(' ');

    spots.push({
      timeUtc: time,
      snr,
      dt,
      freqMHz,
      drift,
      call,
      grid,
      dBm,
      message,
      raw: line,
    });
  }
  return spots;
}

/** Locate the bundled (or dev-built) wsprd executable. */
function resolveWsprdPath() {
  const exe = process.platform === 'win32' ? 'wsprd.exe' : 'wsprd';
  const candidates = [];
  // Packaged: electron-builder extraResources → resources/bin/wsprd
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', exe));
  }
  // Dev: built in place under third_party/wsprd/
  candidates.push(path.join(__dirname, '..', 'third_party', 'wsprd', 'build', exe));
  candidates.push(path.join(__dirname, '..', 'third_party', 'wsprd', exe));
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* keep looking */ }
  }
  return null;
}

/** Write mono Float32 samples (−1..1) as a 16-bit PCM WAV at 12 kHz. */
function writeWav(samples, filePath, sampleRate = SAMPLE_RATE) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // PCM fmt chunk size
  buf.writeUInt16LE(1, 20);           // audio format = PCM
  buf.writeUInt16LE(1, 22);           // channels = 1
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

/**
 * Decode one 2-minute WSPR window. Spawns the bundled GPLv3 wsprd as a separate
 * process (mere aggregation — see file header).
 *
 * @param {Float32Array} samples       ~120 s of 12 kHz mono audio
 * @param {object}   opts
 * @param {number}   opts.dialFreqMHz  USB dial frequency (e.g. 14.0956)
 * @param {string}  [opts.wsprdPath]   override the resolved binary (tests)
 * @returns {{ok:boolean, spots:Array, error?:string}}
 */
function decodeWspr(samples, opts = {}) {
  const wsprd = opts.wsprdPath || resolveWsprdPath();
  if (!wsprd) {
    return { ok: false, spots: [], error: 'wsprd binary not found (WSPR decoder not installed)' };
  }
  const dial = Number(opts.dialFreqMHz);
  if (!Number.isFinite(dial) || dial <= 0) {
    return { ok: false, spots: [], error: 'invalid dial frequency' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'potacat-wspr-'));
  const wavPath = path.join(tmpDir, 'rx.wav');
  try {
    writeWav(samples, wavPath);
    // -f dial(MHz): tells wsprd the band so it reports absolute frequencies.
    // Run in tmpDir so wsprd's ALL_WSPR.TXT/hashtable side-files land there.
    const res = spawnSync(wsprd, ['-f', String(dial), wavPath], {
      cwd: tmpDir,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (res.error) {
      return { ok: false, spots: [], error: `wsprd spawn failed: ${res.error.message}` };
    }
    const spots = parseWsprdOutput(res.stdout || '');
    return { ok: true, spots };
  } catch (e) {
    return { ok: false, spots: [], error: String(e && e.message || e) };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { parseWsprdOutput, decodeWspr, resolveWsprdPath, writeWav, SAMPLE_RATE };
