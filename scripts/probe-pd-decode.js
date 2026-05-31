#!/usr/bin/env node
// Probe PD-mode decode to find where the 12-15 dB PSNR floor comes
// from. Compare encoder vs decoder pixel-by-pixel for the first
// non-trivial line.
'use strict';
const { SstvDecoder, encodeImage } = require('../lib/sstv-worker');
const { MODES } = require('../lib/sstv-modes');

const SAMPLE_RATE = 48000;
const CHUNK = 4096;

function makeImg(w, h) {
  const a = new Uint8ClampedArray(w * h * 4);
  const colors = [
    [255,0,0],[0,255,0],[0,0,255],[255,255,0],
    [0,255,255],[255,0,255],[255,255,255],[64,64,64],
  ];
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

function decode(mode) {
  const m = MODES[mode];
  const src = makeImg(m.width, m.height);
  let samples = encodeImage(src, m.width, m.height, mode);
  const pad = Math.round(SAMPLE_RATE * 0.3);
  const padded = new Float32Array(samples.length + pad*2);
  padded.set(samples, pad);

  const dec = new SstvDecoder();
  let img = null;
  for (let i = 0; i < padded.length; i += CHUNK) {
    const out = dec.processSamples(new Float32Array(padded.subarray(i, Math.min(i+CHUNK, padded.length))));
    for (const r of out) if (r.type === 'rx-image') img = r;
  }
  return { src, dec: img ? img.imageData : null, w: m.width, h: m.height };
}

function diffStats(src, dec, w, h) {
  if (!dec) { console.log('NO DECODE'); return; }
  let maxR=0, maxG=0, maxB=0;
  let sumR=0, sumG=0, sumB=0;
  const buckets = { '0':0, '1-5':0, '6-20':0, '21-50':0, '51-100':0, '101+':0 };
  let cnt = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y*w+x)*4;
      const dr = Math.abs(src[i]-dec[i]);
      const dg = Math.abs(src[i+1]-dec[i+1]);
      const db = Math.abs(src[i+2]-dec[i+2]);
      const m = Math.max(dr, dg, db);
      if (m === 0) buckets['0']++;
      else if (m <= 5) buckets['1-5']++;
      else if (m <= 20) buckets['6-20']++;
      else if (m <= 50) buckets['21-50']++;
      else if (m <= 100) buckets['51-100']++;
      else buckets['101+']++;
      maxR = Math.max(maxR, dr); maxG = Math.max(maxG, dg); maxB = Math.max(maxB, db);
      sumR += dr; sumG += dg; sumB += db;
      cnt++;
    }
  }
  console.log(`Avg |diff|: R=${(sumR/cnt).toFixed(2)} G=${(sumG/cnt).toFixed(2)} B=${(sumB/cnt).toFixed(2)}`);
  console.log(`Max |diff|: R=${maxR} G=${maxG} B=${maxB}`);
  console.log('Per-pixel max-error histogram:', buckets);
}

function sampleRow(src, dec, w, y) {
  console.log(`\nRow ${y} sample (every 40th pixel):`);
  for (let x = 0; x < w; x += 40) {
    const i = (y*w+x)*4;
    const sr = `(${src[i]},${src[i+1]},${src[i+2]})`;
    const dr = dec ? `(${dec[i]},${dec[i+1]},${dec[i+2]})` : '---';
    console.log(`  x=${x}:  src=${sr.padEnd(15)}  dec=${dr}`);
  }
}

for (const mode of ['pd90', 'pd180']) {
  console.log(`\n========== ${mode} ==========`);
  const r = decode(mode);
  diffStats(r.src, r.dec, r.w, r.h);
  sampleRow(r.src, r.dec, r.w, 0);
  sampleRow(r.src, r.dec, r.w, Math.floor(r.h/2));
  sampleRow(r.src, r.dec, r.w, r.h-1);
}
