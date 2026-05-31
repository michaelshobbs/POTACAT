#!/usr/bin/env node
// One-off probe to measure SNR-vs-PSNR for representative modes.
// Not part of the test suite — just discovery data.
'use strict';
const { SstvDecoder, encodeImage } = require('../lib/sstv-worker');
const { MODES } = require('../lib/sstv-modes');

const SAMPLE_RATE = 48000;
const CHUNK = 4096;

function makeTestImage(w, h) {
  const img = new Uint8ClampedArray(w * h * 4);
  const colors = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
    [0, 255, 255], [255, 0, 255], [255, 255, 255], [64, 64, 64],
  ];
  for (let y = 0; y < h; y++) {
    const shade = 1 - 0.3 * (y / h);
    for (let x = 0; x < w; x++) {
      const bar = Math.min(7, Math.floor(x / (w / 8)));
      const [r, g, b] = colors[bar];
      const i = (y * w + x) * 4;
      img[i]     = Math.round(r * shade);
      img[i + 1] = Math.round(g * shade);
      img[i + 2] = Math.round(b * shade);
      img[i + 3] = 255;
    }
  }
  return img;
}
function mse(a, b, w, h) {
  let sum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    sum += (a[i]-b[i])**2 + (a[i+1]-b[i+1])**2 + (a[i+2]-b[i+2])**2;
  }
  return sum / (w*h*3);
}
function psnr(m) { return m === 0 ? Infinity : 10 * Math.log10(255*255/m); }
function addNoise(samples, snrDb, seed) {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i]**2;
  const sigRms = Math.sqrt(sumSq / samples.length);
  const targetNoiseRms = sigRms * Math.pow(10, -snrDb / 20);
  let s = seed >>> 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 2) {
    s = (s * 1664525 + 1013904223) >>> 0; const u1 = Math.max(1e-12, s/4294967296);
    s = (s * 1664525 + 1013904223) >>> 0; const u2 = s/4294967296;
    const mag = Math.sqrt(-2 * Math.log(u1)) * targetNoiseRms;
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    const z1 = mag * Math.sin(2 * Math.PI * u2);
    out[i] = samples[i] + z0;
    if (i + 1 < samples.length) out[i + 1] = samples[i + 1] + z1;
  }
  return out;
}
function run(mode, snr) {
  const m = MODES[mode];
  const src = makeTestImage(m.width, m.height);
  let samples = encodeImage(src, m.width, m.height, mode);
  const pad = Math.round(SAMPLE_RATE * 0.3);
  const padded = new Float32Array(samples.length + pad*2);
  padded.set(samples, pad);
  samples = addNoise(padded, snr, 1);
  const dec = new SstvDecoder();
  let img = null;
  for (let i = 0; i < samples.length; i += CHUNK) {
    const out = dec.processSamples(new Float32Array(samples.subarray(i, Math.min(i+CHUNK, samples.length))));
    for (const r of out) if (r.type === 'rx-image') img = r;
  }
  if (!img) return null;
  return psnr(mse(src, img.imageData, m.width, m.height));
}

const modes = ['martin1', 'scottie1', 'scottie2', 'robot36', 'robot72', 'pd180'];
const snrs = [40, 30, 20, 15, 10, 5, 0];
console.log('SNR/PSNR probe (clean signal + Gaussian noise):\n');
console.log('mode'.padEnd(10), snrs.map(s => (s + 'dB').padStart(7)).join(''));
for (const m of modes) {
  const row = [];
  for (const s of snrs) {
    const p = run(m, s);
    row.push(p === null ? '   ---' : p === Infinity ? '   inf' : p.toFixed(1).padStart(6));
  }
  console.log(m.padEnd(10), row.map(c => c.padStart(7)).join(''));
}
