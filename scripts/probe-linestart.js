#!/usr/bin/env node
// Probe what lineStart actually returns for the first few lines of
// each major mode, so we can verify the sync-detection alignment.
'use strict';
const { SstvDecoder, encodeImage } = require('../lib/sstv-worker');
const { MODES } = require('../lib/sstv-modes');

const SAMPLE_RATE = 48000;
const CHUNK = 4096;

function makeImg(w, h) {
  const a = new Uint8ClampedArray(w * h * 4);
  const colors = [[255,0,0],[0,255,0],[0,0,255],[255,255,0],[0,255,255],[255,0,255],[255,255,255],[64,64,64]];
  for (let y = 0; y < h; y++) {
    const shade = 1 - 0.3 * (y / h);
    for (let x = 0; x < w; x++) {
      const bar = Math.min(7, Math.floor(x / (w/8)));
      const [r,g,b] = colors[bar];
      const i = (y * w + x) * 4;
      a[i]=Math.round(r*shade); a[i+1]=Math.round(g*shade); a[i+2]=Math.round(b*shade); a[i+3]=255;
    }
  }
  return a;
}

function probe(mode) {
  const m = MODES[mode];
  const src = makeImg(m.width, m.height);
  let samples = encodeImage(src, m.width, m.height, mode);
  const pad = Math.round(SAMPLE_RATE * 0.3);
  const padded = new Float32Array(samples.length + pad*2);
  padded.set(samples, pad);

  const dec = new SstvDecoder();
  // Patch _computeLineStart to log
  const origCLS = dec._computeLineStart.bind(dec);
  const log = [];
  dec._computeLineStart = function(mode, lineLen) {
    const peakIdx = this._lineSyncPeakIdx;
    const peakVal = this._lineSyncPeak.toFixed(3);
    const syncStart = this._findSyncStart();
    const r = origCLS(mode, lineLen);
    if (log.length < 5) {
      log.push({
        line: this.lineNum,
        lineLen,
        peakIdx,
        peakVal,
        syncStart,
        lineStart: r,
      });
    }
    return r;
  };

  for (let i = 0; i < padded.length; i += CHUNK) {
    dec.processSamples(new Float32Array(padded.subarray(i, Math.min(i+CHUNK, padded.length))));
  }

  console.log(`\n=== ${mode} ===`);
  console.log(`Mode: syncMs=${m.syncMs}, porchMs=${m.porchMs}, lineLen=${Math.round(SAMPLE_RATE * (m.scanMs || m.height * m.pixelMs || 0) / 1000)}`);
  for (const l of log) {
    console.log(`  line=${l.line} lineLen=${l.lineLen} peakIdx=${l.peakIdx} peakVal=${l.peakVal} syncStart=${l.syncStart} lineStart=${l.lineStart}`);
  }
}

for (const m of ['martin1', 'robot36', 'pd90', 'pd180']) probe(m);
