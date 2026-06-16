'use strict';
//
// Desktop diagnostic-snapshot builder for the Unified Bug Report.
//
// The mobile app requests a snapshot of the shack desktop (version, rig/CAT
// state, tunnel status, recent log) to fill the DESKTOP section of a shared
// bug report. This module is the PURE assembly + redaction step: the live
// data is gathered by main.js and passed in as `input`, so the shaping and
// (critically) the redaction are unit-testable without Electron.
//
// Constraints: pure JavaScript, no Node-only side effects, no I/O. The caller
// owns all gathering (app.getVersion(), reading startup.log, tunnel.getState()).
//
// `redact:true` => the snapshot is safe to paste into a PUBLIC bug report.
// We mask, by exact value, the operator's secrets (callsign, tunnel/host
// names, account email, device tokens) wherever they appear — plus generic
// patterns that commonly leak identity: home-directory usernames in file
// paths and IPv4 addresses. Masking by known value is more reliable than
// guessing patterns; the generic patterns are a backstop for free-text logs.
//

const REDACTED = '[redacted]';

/** Escape a string for use as a literal in a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mask known secret substrings (case-insensitive) and generic identity
 * patterns in a single string. Returns the string unchanged when nothing
 * matches.
 */
function maskString(str, secrets) {
  let out = String(str);
  // 1. Exact known secrets first (callsign, hosts, email, tokens).
  for (const secret of secrets) {
    if (!secret) continue;
    const s = String(secret);
    if (s.length < 3) continue; // too short to mask safely (false positives)
    out = out.replace(new RegExp(escapeRegExp(s), 'gi'), REDACTED);
  }
  // 2. Home-directory usernames in Windows + POSIX paths.
  out = out.replace(/([\\/])Users([\\/])[^\\/\s]+/gi, `$1Users$2${REDACTED}`);
  out = out.replace(/\/home\/[^\\/\s]+/gi, `/home/${REDACTED}`);
  // 3. IPv4 addresses (leave loopback — it's not identifying and is useful).
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) =>
    (m === '127.0.0.1' || m === '0.0.0.0') ? m : REDACTED);
  return out;
}

/** Recursively mask every string in a value (object/array/scalar). */
function deepRedact(value, secrets) {
  if (typeof value === 'string') return maskString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, secrets));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRedact(v, secrets);
    return out;
  }
  return value;
}

/**
 * Build a `diagnostic-snapshot` message object from gathered desktop state.
 *
 * @param {object} input
 *   @param {string}  input.requestId        echo of the request's id (required)
 *   @param {string}  [input.appVersion]     app.getVersion()
 *   @param {string}  [input.platform]       process.platform
 *   @param {string}  [input.osRelease]      os.release()
 *   @param {string}  [input.electronVersion]
 *   @param {string}  [input.nodeVersion]
 *   @param {object}  [input.rigStatus]      the server's radio status snapshot
 *   @param {object}  [input.tunnel]         cloudTunnel.getState() (or subset)
 *   @param {string}  [input.logTail]        last N lines of startup.log
 *   @param {number}  [input.timestamp]      ms epoch the caller stamped
 *   @param {object}  [input.secrets]        { callsign, hosts:[], email, tokens:[] }
 * @param {object} [opts]
 *   @param {boolean} [opts.redact]          mask identifying values
 * @returns {object} a `diagnostic-snapshot` message (ready for _sendTo)
 */
function buildDiagnosticSnapshot(input, opts) {
  input = input || {};
  const redact = !!(opts && opts.redact);
  const requestId = typeof input.requestId === 'string' ? input.requestId : '';

  const sections = {};

  // Each section is built defensively: a malformed input for one section
  // must not sink the whole snapshot — record a per-section error instead.
  function section(name, fn) {
    try { sections[name] = fn(); }
    catch (err) { sections[name] = { error: String((err && err.message) || err) }; }
  }

  section('app', () => ({
    appVersion: input.appVersion || '',
    platform: input.platform || '',
    osRelease: input.osRelease || '',
    electron: input.electronVersion || '',
    node: input.nodeVersion || '',
  }));

  section('rig', () => {
    const s = input.rigStatus;
    if (!s || typeof s !== 'object') return { available: false };
    // Pass through the rig telemetry verbatim (freq, mode, connected, swr,
    // alc, power, model, …). It's untyped on purpose — it mirrors whatever
    // the live status snapshot carries. `type` is the message tag, not data.
    const { type, ...rest } = s;
    return { available: true, ...rest };
  });

  section('tunnel', () => {
    const t = input.tunnel;
    if (!t || typeof t !== 'object') return { enabled: false };
    return {
      enabled: !!t.enabled,
      status: t.status || '',
      cloudHost: t.cloudHost || '',
      degraded: !!t.degraded,
      degradedReason: t.degradedReason || '',
      lastError: t.lastError || '',
    };
  });

  section('log', () => ({
    tail: typeof input.logTail === 'string' ? input.logTail : '',
  }));

  let snapshot = {
    type: 'diagnostic-snapshot',
    requestId,
    source: 'desktop',
    appVersion: input.appVersion || '',
    platform: input.platform || '',
    timestamp: typeof input.timestamp === 'number' ? input.timestamp : undefined,
    sections,
  };

  if (redact) {
    const sec = input.secrets || {};
    const secrets = [
      sec.callsign,
      sec.email,
      ...(Array.isArray(sec.hosts) ? sec.hosts : []),
      ...(Array.isArray(sec.tokens) ? sec.tokens : []),
    ].filter(Boolean);
    // Redact only the payload sections (and top-level appVersion/platform are
    // not sensitive). requestId/source/type/timestamp must stay intact.
    snapshot.sections = deepRedact(snapshot.sections, secrets);
  }

  // Drop an undefined timestamp so the wire stays clean (optional field).
  if (snapshot.timestamp === undefined) delete snapshot.timestamp;

  return snapshot;
}

module.exports = { buildDiagnosticSnapshot, maskString, deepRedact, REDACTED };
