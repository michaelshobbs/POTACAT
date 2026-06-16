// Desktop diagnostic-snapshot responder (Unified Bug Report).
// Covers the three layers of the #1 responder:
//   - lib/diagnostic-snapshot.js  — pure assembly + redaction
//   - lib/echocat-protocol.js     — request-diagnostic / diagnostic-snapshot wire schemas
//   - lib/remote-server.js        — inbound handler: owner emits, guest is refused
//
// Bug: desktop never answered request-diagnostic, so every mobile bug report
// showed no desktop snapshot (work/in-progress/desktop-request-diagnostic-
// responder.md).
//
// Run: node test/diagnostic-snapshot-test.js

'use strict';

const { buildDiagnosticSnapshot, maskString, REDACTED } = require('../lib/diagnostic-snapshot');
const protocol = require('../lib/echocat-protocol');
const { RemoteServer } = require('../lib/remote-server');

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ FAIL: ' + label); }
}
function eq(actual, expected, label) {
  check(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('=== buildDiagnosticSnapshot: shape ===');

const baseInput = {
  requestId: 'req-1',
  appVersion: '1.8.13',
  platform: 'win32',
  osRelease: '10.0.26200',
  electronVersion: '32.0.0',
  nodeVersion: '22.0.0',
  rigStatus: { type: 'status', model: 'Flex 8600M', freqKhz: 14074, mode: 'DIGU', connected: true, swr: 1.2 },
  tunnel: { enabled: true, status: 'live', cloudHost: 'shack.example.com', degraded: false, lastError: '' },
  logTail: 'line A\nline B',
  timestamp: 1700000000000,
  secrets: { callsign: 'K3SBP', email: 'casey@cmox.co', hosts: ['shack.example.com'], tokens: [] },
};

{
  const snap = buildDiagnosticSnapshot(baseInput, { redact: false });
  eq(snap.type, 'diagnostic-snapshot', 'message type');
  eq(snap.requestId, 'req-1', 'requestId echoed');
  eq(snap.source, 'desktop', 'source is desktop');
  eq(snap.timestamp, 1700000000000, 'timestamp passed through');
  check(snap.sections && typeof snap.sections === 'object', 'sections present');
  eq(Object.keys(snap.sections).sort(), ['app', 'log', 'rig', 'tunnel'], 'four sections');
  eq(snap.sections.app.electron, '32.0.0', 'app.electron');
  eq(snap.sections.rig.available, true, 'rig available');
  eq(snap.sections.rig.model, 'Flex 8600M', 'rig model passed through');
  check(!('type' in snap.sections.rig), 'rig section drops the status message tag');
  eq(snap.sections.tunnel.cloudHost, 'shack.example.com', 'tunnel host (unredacted)');
  eq(snap.sections.log.tail, 'line A\nline B', 'log tail');
}

{
  // No rig status / no tunnel → graceful "not available" rather than throwing.
  const snap = buildDiagnosticSnapshot({ requestId: 'r2' }, {});
  eq(snap.sections.rig, { available: false }, 'rig unavailable when no status');
  eq(snap.sections.tunnel, { enabled: false }, 'tunnel disabled when no state');
  check(!('timestamp' in snap), 'absent timestamp is dropped from the wire');
}

{
  // A section that throws is isolated — the snapshot still ships.
  const evil = {};
  Object.defineProperty(evil, 'boom', { enumerable: true, get() { throw new Error('kaboom'); } });
  const snap = buildDiagnosticSnapshot({ requestId: 'r3', rigStatus: evil }, {});
  check(snap.sections.rig && typeof snap.sections.rig.error === 'string', 'throwing rig section -> per-section error');
  eq(snap.sections.app.appVersion, '', 'other sections still built after one fails');
  eq(snap.requestId, 'r3', 'snapshot still returns despite section failure');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== redaction (redact:true) ===');

{
  const input = {
    ...baseInput,
    logTail: 'op K3SBP at C:\\Users\\casey\\AppData\\pota.log peer 192.168.1.50 loop 127.0.0.1 mail casey@cmox.co',
    rigStatus: { type: 'status', model: 'Flex 8600M', operator: 'K3SBP', connected: true },
  };
  const snap = buildDiagnosticSnapshot(input, { redact: true });
  const tail = snap.sections.log.tail;
  check(!tail.includes('K3SBP'), 'callsign masked in log');
  check(!tail.includes('casey@cmox.co'), 'email masked in log');
  check(!tail.includes('192.168.1.50'), 'public IPv4 masked in log');
  check(tail.includes('127.0.0.1'), 'loopback IP preserved');
  check(!/Users[\\/]casey/i.test(tail), 'home-dir username masked');
  check(snap.sections.tunnel.cloudHost === REDACTED, 'tunnel host masked (in secrets.hosts)');
  check(snap.sections.rig.operator === REDACTED, 'callsign in rig telemetry masked');
  // Identity-bearing envelope fields must survive — the report needs them.
  eq(snap.requestId, 'req-1', 'requestId NOT redacted');
  eq(snap.source, 'desktop', 'source NOT redacted');
}

{
  // Short secrets must not be masked (would shred unrelated text).
  const out = maskString('the cat sat', ['a']);
  eq(out, 'the cat sat', 'secrets shorter than 3 chars are ignored');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== protocol: wire schemas ===');

check(protocol.isKnownType('request-diagnostic'), 'request-diagnostic registered');
check(protocol.isKnownType('diagnostic-snapshot'), 'diagnostic-snapshot registered');

{
  const v = protocol.validate({ type: 'request-diagnostic', requestId: 'x', redact: true }, protocol.Dir.C2S);
  check(v.ok, 'valid request-diagnostic (c2s) accepted');
}
{
  const v = protocol.validate({ type: 'request-diagnostic' }, protocol.Dir.C2S);
  check(!v.ok && v.field === 'requestId', 'request-diagnostic without requestId rejected');
}
{
  const v = protocol.validate({ type: 'request-diagnostic', requestId: 'x' }, protocol.Dir.S2C);
  check(!v.ok, 'request-diagnostic refused in the s2c direction');
}
{
  // Full snapshot (with an any-bag sections object) encodes + parses back.
  const msg = { type: 'diagnostic-snapshot', requestId: 'x', source: 'desktop', appVersion: '1.8.13', platform: 'win32', timestamp: 1700000000000, sections: { app: { node: '22' }, rig: { available: false } } };
  const wire = protocol.encode(msg);
  const parsed = protocol.parse(wire, protocol.Dir.S2C);
  check(parsed.ok, 'diagnostic-snapshot encodes + parses (s2c)');
  eq(parsed.msg.requestId, 'x', 'requestId round-trips');
}
{
  // Error-only snapshot (refusal / failure) is still valid — no sections.
  const v = protocol.validate({ type: 'diagnostic-snapshot', requestId: 'x', source: 'desktop', error: 'not-authorized' });
  check(v.ok, 'error-only snapshot validates (no sections required)');
}
{
  const hello = protocol.buildServerHello({ capabilities: ['diagnostic-snapshot'] });
  check(Array.isArray(hello.capabilities) && hello.capabilities.includes('diagnostic-snapshot'),
    'server hello carries the diagnostic-snapshot capability');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== server handler: owner emits, guest refused ===');

function fakeWs() {
  const sent = [];
  return {
    _authenticated: true,
    readyState: 1, // WebSocket.OPEN
    send: (wire) => { try { sent.push(JSON.parse(wire)); } catch {} },
    _sent: sent,
  };
}

{
  // Owner (no _passSession): handler emits an event for main.js to gather,
  // and does NOT reply directly.
  const rs = new RemoteServer();
  const ws = fakeWs();
  rs._client = ws;
  const events = [];
  rs.on('request-diagnostic', (e) => events.push(e));
  rs._handleMessage(ws, { type: 'request-diagnostic', requestId: 'abc', redact: true }, {});
  eq(events.length, 1, 'owner request emits request-diagnostic');
  eq(events[0], { requestId: 'abc', redact: true }, 'event carries requestId + redact');
  eq(ws._sent.length, 0, 'owner path sends no immediate reply (main.js replies)');
}

{
  // Guest Pass session: refused with an error snapshot, NOT emitted.
  const rs = new RemoteServer();
  const ws = fakeWs();
  ws._passSession = { code: 'GUEST1' };
  rs._client = ws;
  let emitted = 0;
  rs.on('request-diagnostic', () => { emitted++; });
  rs._handleMessage(ws, { type: 'request-diagnostic', requestId: 'g1' }, {});
  eq(emitted, 0, 'guest request does NOT emit');
  eq(ws._sent.length, 1, 'guest gets an immediate reply');
  eq(ws._sent[0].type, 'diagnostic-snapshot', 'guest reply is a diagnostic-snapshot');
  eq(ws._sent[0].error, 'not-authorized', 'guest reply carries not-authorized error');
  eq(ws._sent[0].requestId, 'g1', 'guest reply echoes requestId (no client timeout)');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
