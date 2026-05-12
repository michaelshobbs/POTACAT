#!/usr/bin/env node
/**
 * Standalone smoke test for the alsa_native addon.
 *
 * Lists every ALSA device the addon can see, then optionally captures
 * a few seconds from one and writes a WAV — proves the read path works
 * end-to-end without launching Electron.
 *
 * Usage:
 *   node scripts/test-alsa.js                    # list devices
 *   node scripts/test-alsa.js hw:1,1             # capture 5s from hw:1,1
 *   node scripts/test-alsa.js plughw:1,1 10      # capture 10s from plughw:1,1
 *   node scripts/test-alsa.js hw:1,1 5 out.wav   # write to a specific file
 *
 * Output WAV is 48 kHz mono 16-bit PCM by default. Listen with `aplay
 * /tmp/alsa-capture-*.wav` or `sox out.wav -d` to verify the right
 * audio actually landed in the file.
 *
 * Linux-only — bails with a clear message on Win/Mac.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const alsa = require('../lib/alsa');

if (!alsa.isAvailable()) {
  console.error('alsa_native not available on this platform (' + alsa._platform() + ')');
  const err = alsa._loadError();
  if (err) console.error('Load error: ' + err);
  process.exit(1);
}

console.log('libasound version: ' + alsa._alsaVersion());
console.log('');

const devices = alsa.listDevices();
if (!devices.length) {
  console.log('No devices found. (Is snd-aloop loaded? Are you in the `audio` group?)');
  process.exit(0);
}

console.log(`Found ${devices.length} ALSA stream(s):`);
for (const d of devices) {
  console.log(`  [${d.kind === 'audioinput' ? 'IN ' : 'OUT'}] ${d.id.padEnd(14)} card=${d.card} dev=${d.device} plug=${d.isPlughw ? 'Y' : 'N'}  ${d.label}`);
}
console.log('');

const target = process.argv[2];
if (!target) {
  console.log('To capture: node scripts/test-alsa.js <device> [seconds] [out.wav]');
  process.exit(0);
}

const seconds = parseFloat(process.argv[3]) || 5;
const outFile = process.argv[4] || `/tmp/alsa-capture-${Date.now()}.wav`;
const rate = 48000;

console.log(`Capturing ${seconds}s from ${target} → ${outFile}`);

// Accumulate Float32 chunks first, then convert once at the end. Keeps
// the audio loop allocation-free across the capture.
const chunks = [];
let totalFrames = 0;
let stopHandle;

const startedAt = Date.now();
try {
  stopHandle = alsa.startCapture(target, {
    rate,
    channels: 1,
    chunkFrames: rate / 10, // 100ms chunks
    intervalMs: 50,
    onAudio: (frames) => {
      chunks.push(new Float32Array(frames)); // copy out of the addon's reusable buffer
      totalFrames += frames.length;
      process.stdout.write(`\r  ${(totalFrames / rate).toFixed(2)}s captured...`);
    },
    onError: (err) => {
      console.error('\nCapture error: ' + err.message);
      process.exit(1);
    },
  });
  console.log(`  Opened at ${stopHandle.rate} Hz × ${stopHandle.channels} ch`);
} catch (err) {
  console.error('startCapture failed: ' + err.message);
  process.exit(1);
}

setTimeout(() => {
  stopHandle.stop();
  console.log(`\n  Done. ${totalFrames} frames in ${((Date.now() - startedAt) / 1000).toFixed(2)}s real-time.`);

  // Concatenate into one Float32 buffer, then quantize to S16 LE for the WAV.
  const all = new Float32Array(totalFrames);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }

  const pcm = Buffer.alloc(totalFrames * 2);
  for (let i = 0; i < totalFrames; i++) {
    let s = Math.max(-1, Math.min(1, all[i]));
    pcm.writeInt16LE((s * 32767) | 0, i * 2);
  }

  // Standard 16-bit PCM WAV header
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + pcm.length, 4);
  hdr.write('WAVEfmt ', 8);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);             // PCM
  hdr.writeUInt16LE(1, 22);             // mono
  hdr.writeUInt32LE(stopHandle.rate, 24);
  hdr.writeUInt32LE(stopHandle.rate * 2, 28); // byte rate
  hdr.writeUInt16LE(2, 32);             // block align
  hdr.writeUInt16LE(16, 34);            // bits per sample
  hdr.write('data', 36);
  hdr.writeUInt32LE(pcm.length, 40);

  fs.writeFileSync(outFile, Buffer.concat([hdr, pcm]));
  console.log(`  Wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);

  // Cheap signal-presence check — RMS of the captured float buffer.
  // Useful for "is anything actually flowing?" debugging on loopback
  // setups where you may have wired the wrong end of the pair.
  let sumSq = 0;
  for (let i = 0; i < totalFrames; i++) sumSq += all[i] * all[i];
  const rms = totalFrames ? Math.sqrt(sumSq / totalFrames) : 0;
  const dbfs = rms > 0 ? (20 * Math.log10(rms)).toFixed(1) : '-inf';
  console.log(`  RMS: ${rms.toFixed(5)}  (${dbfs} dBFS)  ${rms < 1e-5 ? '— SILENT (check the loopback wiring)' : ''}`);

  process.exit(0);
}, seconds * 1000);
