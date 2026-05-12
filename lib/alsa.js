/**
 * lib/alsa.js — JS wrapper around the alsa_native N-API addon.
 *
 * Two reasons this wrapper exists rather than letting callers `require`
 * the addon directly:
 *
 *   1. Cross-platform safety. The addon's binding.gyp compiles a stub
 *      on Windows / macOS that exports { available: false } — but the
 *      `.node` file may also be missing entirely if `npm install` ran
 *      with the postinstall hook disabled. Wrapper catches both cases
 *      and always returns a stable shape; callers never need a try/catch
 *      around their list-devices / open-capture calls.
 *
 *   2. A friendlier capture API. The raw addon is a pull-style readCapture
 *      that returns whatever's in the ALSA buffer right now. Most consumers
 *      (FT8, SSTV, ECHOCAT mic) want "a stream of N-frame chunks at rate R,
 *      keep going until I stop you". Wrapper exposes that pattern as
 *      startCapture({ ... onAudio, onError }) → { stop }.
 *
 * Linux-only. On every other platform this module is a stable no-op:
 *   - isAvailable() returns false
 *   - listDevices() returns []
 *   - startCapture() throws (callers should isAvailable-gate)
 */
'use strict';

const path = require('path');

let native = null;
let loadError = null;

// Resolve relative to __dirname so the same module works from a packaged
// app.asar.unpacked path and from a dev tree.
try {
  if (process.platform === 'linux') {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    native = require(path.join(__dirname, 'alsa_native', 'build', 'Release', 'alsa_native.node'));
  }
} catch (err) {
  loadError = err;
}

function isAvailable() {
  return !!(native && native.available);
}

function listDevices() {
  if (!isAvailable()) return [];
  try {
    return native.listDevices();
  } catch (err) {
    return [];
  }
}

/**
 * Start a continuous capture from the named ALSA PCM. Pulls Float32 mono
 * frames at the requested rate, in chunks of approximately `chunkFrames`,
 * and hands each chunk to `onAudio(Float32Array)`. The reader runs on a
 * setInterval — the libuv thread is never blocked — so other IPC keeps
 * flowing on Pi-class hosts where the audio capture and the spot pipeline
 * share a single core.
 *
 * Returns { stop, rate, channels } where stop() releases the ALSA handle
 * and any callback subscriptions. Safe to call stop multiple times.
 *
 * @param {string}   name       ALSA PCM name (e.g. "hw:1,1", "plughw:1,1", "default")
 * @param {object}   opts
 * @param {number}  [opts.rate=48000]
 * @param {number}  [opts.channels=1]       requested; actual returned in result
 * @param {number}  [opts.chunkFrames=4800] frames per onAudio invocation
 * @param {number}  [opts.intervalMs=50]    poll cadence
 * @param {Function} opts.onAudio           (Float32Array, { rate, channels }) => void
 * @param {Function} [opts.onError]         (Error) => void  — fatal stream errors only
 */
function startCapture(name, opts) {
  if (!isAvailable()) {
    throw new Error('alsa: native addon not available on this platform' +
      (loadError ? ` (${loadError.message})` : ''));
  }
  if (!name || typeof name !== 'string') {
    throw new Error('alsa.startCapture: name (ALSA PCM string) required');
  }
  if (!opts || typeof opts.onAudio !== 'function') {
    throw new Error('alsa.startCapture: opts.onAudio callback required');
  }

  const rate         = opts.rate         || 48000;
  const channels     = opts.channels     || 1;
  const chunkFrames  = opts.chunkFrames  || Math.max(512, Math.floor(rate / 20));
  const intervalMs   = opts.intervalMs   || 50;

  let openInfo;
  try {
    openInfo = native.openCapture(name, {
      rate,
      channels,
      // periodFrames sized so a couple of poll ticks worth of audio fits
      // before snd_pcm_readi blocks/XRUNs. 4× chunkFrames is loose enough
      // for tick jitter on Pi class hosts, tight enough to keep latency
      // reasonable for ECHOCAT (where round-trip latency matters).
      periodFrames: Math.max(256, Math.floor(chunkFrames / 4)),
      bufferFrames: Math.max(2048, chunkFrames * 4),
    });
  } catch (err) {
    if (typeof opts.onError === 'function') opts.onError(err);
    throw err;
  }

  const handle = openInfo.handle;
  let stopped = false;
  const meta = { rate: openInfo.rate, channels: openInfo.channels };

  const timer = setInterval(() => {
    if (stopped) return;
    let frames;
    try {
      frames = native.readCapture(handle, chunkFrames);
    } catch (err) {
      stopped = true;
      clearInterval(timer);
      try { native.closeCapture(handle); } catch {}
      if (typeof opts.onError === 'function') opts.onError(err);
      return;
    }
    // The addon attaches `.closed = true` on the returned typedarray to
    // signal a fatal close (handle is already freed inside the addon).
    if (frames && frames.closed) {
      stopped = true;
      clearInterval(timer);
      if (typeof opts.onError === 'function') {
        opts.onError(new Error('alsa: capture stream closed by driver (likely device disconnect or XRUN-unrecoverable)'));
      }
      return;
    }
    if (frames && frames.length) {
      try { opts.onAudio(frames, meta); }
      catch (err) { /* swallow consumer errors — capture loop must keep running */ }
    }
  }, intervalMs);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try { native.closeCapture(handle); } catch {}
  }

  return { stop, rate: meta.rate, channels: meta.channels };
}

module.exports = {
  isAvailable,
  listDevices,
  startCapture,
  // Surface why the addon's missing for verbose-log diagnosis on Linux
  // hosts that hit a build failure (libasound2-dev missing, etc.).
  _loadError: () => (loadError ? loadError.message : null),
  _platform: () => (native && native.platform) || process.platform,
  _alsaVersion: () => (native && native.alsaVersion) || null,
};
