// Cloud Tunnel web-UI gate (regression, 2026-06-13). Turning on the
// Cloud Tunnel made the plain LAN/Tailscale web URL serve the
// "paired devices only" stub instead of the ECHOCAT web app — killing
// the free, no-app/no-subscription path. The stub must show ONLY for
// public visitors arriving over the tunnel; LAN, Tailscale, and local
// browsers get the real UI.
// Run: node test/tunnel-webui-gate-test.js

'use strict';

const https = require('https');
const { RemoteServer } = require('../lib/remote-server');

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ FAIL: ' + label); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Unit: the discriminator ────────────────────────────────────────
console.log('=== _isTunnelOrPublicRequest ===');
const T = (h, ip) => RemoteServer._isTunnelOrPublicRequest(h, ip);
check(T({ 'cf-ray': '8a1b2c3d-EWR' }, '127.0.0.1') === true, 'Cloudflare cf-ray header → tunnel (even from loopback)');
check(T({ 'cf-connecting-ip': '203.0.113.9' }, '127.0.0.1') === true, 'cf-connecting-ip header → tunnel');
check(T({}, '192.168.1.50') === false, 'direct LAN 192.168 → not tunnel');
check(T({}, '10.0.0.9') === false, 'direct LAN 10/8 → not tunnel');
check(T({}, '172.20.1.1') === false, 'direct LAN 172.16/12 → not tunnel');
check(T({}, '100.94.0.7') === false, 'Tailscale CGNAT 100.64/10 → not tunnel (must be allowed!)');
check(T({}, '127.0.0.1') === false, 'loopback / local browser → not tunnel');
check(T({}, '::1') === false, 'IPv6 loopback → not tunnel');
check(T({}, '::ffff:192.168.1.5') === false, 'IPv6-mapped LAN → not tunnel');
check(T({}, 'fe80::1') === false, 'IPv6 link-local → not tunnel');
check(T({}, '169.254.5.5') === false, 'IPv4 link-local → not tunnel');
check(T({}, '8.8.8.8') === true, 'plain public IPv4 (direct port-forward) → tunnel/public');
check(T({}, '') === false, 'unknown source → treated as direct (token still gates actions)');
check(T(null, '192.168.1.1') === false, 'no headers object → falls through to source check');

// ── Integration: stub fires only for tunnel/public ─────────────────
(async () => {
  console.log('\n=== live gate (tunnel exposed) ===');
  const rs = new RemoteServer();
  rs._serverVersion = 'test';
  rs.start(17350, null, { requireToken: true, tunnelExposed: true });
  await sleep(500);
  const port = rs._port;

  const get = (extraHeaders) => new Promise((resolve) => {
    const req = https.request({
      host: '127.0.0.1', port, path: '/', method: 'GET',
      headers: extraHeaders || {}, rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ status: -1, body: '' }));
    req.end();
  });
  const isStub = (r) => r.status === 503 && /accepts connections from paired/.test(r.body);

  // Direct LAN/local browser (loopback source, no CF headers): real UI.
  const direct = await get();
  check(!isStub(direct), 'direct request (loopback, no CF headers) does NOT get the stub');
  check(direct.status === 200, 'direct request is served the web UI (200)');

  // Same connection but carrying Cloudflare edge headers = via tunnel.
  const tunneled = await get({ 'cf-ray': '8a1b2c3d4e5f-EWR', 'cf-connecting-ip': '203.0.113.42' });
  check(isStub(tunneled), 'request with Cloudflare edge headers gets the stub');

  // /health stays open over the tunnel (whitelist intact).
  const health = await new Promise((resolve) => {
    const req = https.request({ host: '127.0.0.1', port, path: '/health', method: 'GET',
      headers: { 'cf-ray': 'x-EWR' }, rejectUnauthorized: false }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', () => resolve({ status: -1 })); req.end();
  });
  check(health.status === 200 && /ok/.test(health.body), '/health still open over the tunnel');

  rs.stop();
  await sleep(100);
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
