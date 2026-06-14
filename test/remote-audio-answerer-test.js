// Unit tests for the desktop-client WebRTC answerer module's ORCHESTRATION
// (renderer/remote-audio-answerer.js) — when it answers, ICE buffering,
// relay-only, mic gating, teardown. WebRTC + getUserMedia are mocked so this
// runs in pure Node (the REAL media path is covered by the Chromium loopback
// in test-output/answerer-loopback-test.js).
// Run: node test/remote-audio-answerer-test.js
'use strict';

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ FAIL: ' + label); }
}

// ── Mock WebRTC + media into the global the module reads ─────────────
const calls = { addTrack: 0, addTransceiver: 0, addIce: [], setRemote: [], setLocal: [], setConfiguration: [], closed: 0 };
class FakePC {
  constructor(config) { this.config = config; this.remoteDescription = null; this.localDescription = null;
    this.connectionState = 'new'; this.iceConnectionState = 'new';
    this.ontrack = null; this.onicecandidate = null; this.onconnectionstatechange = null; this.oniceconnectionstatechange = null; }
  addTrack() { calls.addTrack++; }
  addTransceiver() { calls.addTransceiver++; }
  async setRemoteDescription(d) { calls.setRemote.push(d); this.remoteDescription = d; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\nanswer-sdp' }; }
  async setLocalDescription(d) { calls.setLocal.push(d); this.localDescription = d; }
  async addIceCandidate(c) { calls.addIce.push(c); }
  setConfiguration(c) { calls.setConfiguration.push(c); }
  close() { calls.closed++; }
}
let micEnabled = true; let micStopped = 0;
const fakeTrack = { kind: 'audio', get enabled() { return micEnabled; }, set enabled(v) { micEnabled = v; }, stop() { micStopped++; } };
const fakeStream = { getAudioTracks: () => [fakeTrack], getTracks: () => [fakeTrack] };

global.RTCPeerConnection = FakePC;
global.MediaStream = function () {};

const { RemoteAudioAnswerer } = require('../lib/../renderer/remote-audio-answerer.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ── start(): mic captured (muted), pc built with iceServers, start-audio sent
  console.log('=== start() ===');
  const out = [];
  let track = null;
  const a = new RemoteAudioAnswerer({
    getUserMedia: async () => { micEnabled = true; return fakeStream; },
    onSignal: (d) => out.push(d),
    onTrack: (s) => { track = s; },
  });
  a.setIceConfig({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }] });
  await a.start();
  check(out.some(d => d.type === 'start-audio'), 'start() emits start-audio to the shack');
  check(calls.addTrack === 1, 'mic track added to the peer (TX path)');
  check(micEnabled === false, 'mic is MUTED by default (no VOX) until PTT');
  check(a._pc && Array.isArray(a._pc.config.iceServers) && a._pc.config.iceServers[0].username === 'u', 'peer built with the shack TURN iceServers');

  // ── relayOnly forces relay transport policy ─────────────────────────
  console.log('\n=== relayOnly ===');
  a.setIceConfig({ relayOnly: true });
  check(calls.setConfiguration.length >= 1 && calls.setConfiguration.slice(-1)[0].iceTransportPolicy === 'relay', 'relayOnly → setConfiguration({iceTransportPolicy:relay}) on live pc');

  // ── handleSignal(offer) → answers ───────────────────────────────────
  console.log('\n=== answer to offer ===');
  out.length = 0;
  await a.handleSignal({ type: 'sdp', sdp: { type: 'offer', sdp: 'v=0\r\noffer' } });
  check(calls.setRemote.some(d => d.type === 'offer'), 'offer applied via setRemoteDescription');
  const ans = out.find(d => d.type === 'sdp');
  check(ans && ans.sdp && ans.sdp.type === 'answer', 'emits an SDP answer back to the shack');
  check(calls.setLocal.some(d => d.type === 'answer'), 'answer applied via setLocalDescription');

  // ── ICE buffering: candidate before offer is held, drained after ─────
  console.log('\n=== ICE buffering ===');
  const b = new RemoteAudioAnswerer({ getUserMedia: async () => fakeStream, onSignal: () => {}, onTrack: () => {} });
  calls.addIce.length = 0;
  await b.start();
  await b.handleSignal({ type: 'ice', candidate: { candidate: 'early', sdpMid: '0', sdpMLineIndex: 0 } });
  check(calls.addIce.length === 0, 'ICE arriving BEFORE the offer is buffered, not applied');
  await b.handleSignal({ type: 'sdp', sdp: { type: 'offer', sdp: 'o' } });
  check(calls.addIce.some(c => c.candidate === 'early'), 'buffered ICE is drained after the offer applies');
  await b.handleSignal({ type: 'ice', candidate: { candidate: 'late', sdpMid: '0', sdpMLineIndex: 0 } });
  check(calls.addIce.some(c => c.candidate === 'late'), 'ICE arriving AFTER the offer is applied immediately');

  // ── PTT mic gating ──────────────────────────────────────────────────
  console.log('\n=== PTT mic gating ===');
  micEnabled = false;
  a.setMicEnabled(true);
  check(micEnabled === true, 'setMicEnabled(true) opens the mic for PTT');
  a.setMicEnabled(false);
  check(micEnabled === false, 'setMicEnabled(false) closes the mic');

  // ── onTrack fires playback ──────────────────────────────────────────
  console.log('\n=== onTrack ===');
  a._pc.ontrack({ streams: [fakeStream], track: fakeTrack });
  check(track === fakeStream, 'ontrack forwards the rig stream to playback');

  // ── stop() tears down ───────────────────────────────────────────────
  console.log('\n=== stop() ===');
  const before = calls.closed;
  micStopped = 0;
  a.stop();
  check(calls.closed === before + 1, 'stop() closes the peer connection');
  check(micStopped === 1, 'stop() stops the mic track');
  check(a._pc === null, 'pc reference cleared');

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
