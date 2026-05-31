#!/usr/bin/env node
// Diagnostic probe for the robot36 @ 30dB SNR seed=1 anomaly.
// Shows per-line sync peak positions, slant convergence, and the
// final decoded PSNR so we can see WHERE the decoder goes wrong.
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
function imageMSE(a, b, w, h) {
  let s = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y*w+x)*4;
    s += (a[i]-b[i])**2 + (a[i+1]-b[i+1])**2 + (a[i+2]-b[i+2])**2;
  }
  return s / (w*h*3);
}
function psnr(m) { return m === 0 ? Infinity : 10 * Math.log10(255*255/m); }

function addNoise(samples, snr, seed) {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i]*samples[i];
  const sigRms = Math.sqrt(sumSq / samples.length);
  const tgt = sigRms * Math.pow(10, -snr/20);
  let s = seed >>> 0;
  const o = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 2) {
    s = (s*1664525+1013904223)>>>0; const u1 = Math.max(1e-12, s/4294967296);
    s = (s*1664525+1013904223)>>>0; const u2 = s/4294967296;
    const mag = Math.sqrt(-2*Math.log(u1)) * tgt;
    o[i] = samples[i] + mag * Math.cos(2*Math.PI*u2);
    if (i+1 < samples.length) o[i+1] = samples[i+1] + mag * Math.sin(2*Math.PI*u2);
  }
  return o;
}

function runScenario(label, mode, snr, seed) {
  const m = MODES[mode];
  const src = makeImg(m.width, m.height);
  let samples = encodeImage(src, m.width, m.height, mode);
  const pad = Math.round(SAMPLE_RATE * 0.3);
  const padded = new Float32Array(samples.length + pad*2);
  padded.set(samples, pad);
  samples = snr != null ? addNoise(padded, snr, seed) : padded;

  const dec = new SstvDecoder();
  // Snapshots
  const slantHistory = [];
  let img = null;
  let stats = null;

  // Patch _refineSlant to log
  const origUpdate = dec._updateSlant.bind(dec);
  dec._updateSlant = function() {
    const before = this.slantFactor;
    // Snapshot the regressor data before compute
    const dataSnapshot = this.slantRegressor.lines.slice();
    origUpdate();
    if (this.slantFactor !== before) {
      // What residuals did the fit have?
      const lineWidth = this._nominalLineSamples();
      const fit = { k0: 0 }; // recompute for diagnosis
      // simple slope across all points
      let T=0,L=0,TT=0,TL=0;
      const m = dataSnapshot.length;
      for (const {idx, pos} of dataSnapshot) { T+=idx; L+=pos; TT+=idx*idx; TL+=idx*pos; }
      const denom = m*TT - T*T;
      const k0 = denom !== 0 ? (m*TL - L*T)/denom : 0;
      const intercept = (L - k0*T)/m;
      const residuals = dataSnapshot.map(({idx,pos}) => pos - (k0*idx + intercept));
      const absRes = residuals.map(Math.abs).sort((a,b)=>a-b);
      const medRes = absRes[Math.floor(absRes.length/2)];
      const maxRes = absRes[absRes.length-1];
      slantHistory.push({
        line: this.lineNum,
        slant: ((this.slantFactor-1)*1e6).toFixed(1) + 'ppm',
        npts: m,
        medRes: medRes.toFixed(2),
        maxRes: maxRes.toFixed(2),
      });
    }
  };

  for (let i = 0; i < samples.length; i += CHUNK) {
    const out = dec.processSamples(new Float32Array(samples.subarray(i, Math.min(i+CHUNK, samples.length))));
    for (const r of out) {
      if (r.type === 'rx-image') { img = r; stats = r.stats; }
    }
  }
  const p = img ? psnr(imageMSE(src, img.imageData, m.width, m.height)) : null;
  console.log(`\n=== ${label} (${mode} snr=${snr ?? 'clean'} seed=${seed ?? '-'}) ===`);
  console.log(`PSNR: ${p == null ? 'NULL' : p.toFixed(2) + ' dB'}`);
  console.log(`Stats: sync=${stats?.sync}% spread=${stats?.spread} mode=${stats?.mode}`);
  console.log(`Final slantFactor: ${((dec.slantFactor-1)*1e6).toFixed(1)} ppm`);
  console.log(`Slant history (${slantHistory.length} adjustments):`);
  for (const h of slantHistory) console.log(`  line ${h.line}: → ${h.slant} (n=${h.npts} medRes=${h.medRes} maxRes=${h.maxRes})`);
  return { psnr: p, stats, slant: dec.slantFactor };
}

console.log('Robot 36 sync diagnosis — comparing seeds at same SNR');
runScenario('CLEAN',       'robot36', null, null);
runScenario('30dB seed=1', 'robot36', 30,   1);
runScenario('30dB seed=42','robot36', 30,   42);
runScenario('20dB seed=1', 'robot36', 20,   1);
