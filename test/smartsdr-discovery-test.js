#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
//
// SmartSDR GUI-client discovery regression. Run: node test/smartsdr-discovery-test.js
//
// Guards the fix for the "bound to our own ghost" bug: after a reconnect the
// radio still reports POTACAT's PREVIOUS GUI-client registration (old handle,
// often client_id=0). POTACAT must recognize that as itself and NOT add it to
// _discoveredGuiClients (which would make _promoteOrBind ride along with the
// ghost → tuneless + silent audio). External GUI clients (SmartSDR-Win, etc.)
// must STILL be discovered so genuine "ride along" keeps working.

const assert = require('assert');
const { SmartSdrClient } = require('../lib/smartsdr');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

function newClient() {
  const c = new SmartSdrClient();
  c.connected = true;
  c._handleLine('H2EE80C53');                                   // our handle this (reconnected) session
  c._ownHandles.add('75FFB914');                                 // a handle we used in the prior session
  c.setPersistentId('D76F3587-F462-43B1-9280-EBDA60486E78');     // our persistent GUI client_id
  return c;
}
const S = (h, body) => `S${h}|client 0x${h} connected ${body}`;

check('external SmartSDR-Win GUI client IS discovered (ride-along preserved)', () => {
  const c = newClient();
  c._handleLine(S('4E1DDC50', 'client_id=FC77859A-1111-2222-3333-444455556666 program=SmartSDR-Win station=Home'));
  assert.deepStrictEqual(c._discoveredGuiClients, ['FC77859A-1111-2222-3333-444455556666']);
});

check('our ghost by STATION=POTACAT is NOT discovered', () => {
  const c = newClient();
  c._handleLine(S('AABBCCDD', 'client_id=0 station=POTACAT'));
  assert.strictEqual(c._discoveredGuiClients.length, 0);
});

check('our ghost by PROGRAM=POTACAT is NOT discovered', () => {
  const c = newClient();
  c._handleLine(S('AABBCCDD', 'client_id=0 program=POTACAT'));
  assert.strictEqual(c._discoveredGuiClients.length, 0);
});

check('our ghost by OLD HANDLE (from prior session) is NOT discovered', () => {
  const c = newClient(); // _ownHandles has 75FFB914
  c._handleLine(S('75FFB914', 'client_id=0'));   // the exact ghost from the bug log
  assert.strictEqual(c._discoveredGuiClients.length, 0);
});

check('our ghost by persistent client_id is NOT discovered', () => {
  const c = newClient();
  c._handleLine(S('11223344', 'client_id=D76F3587-F462-43B1-9280-EBDA60486E78 program=whatever'));
  assert.strictEqual(c._discoveredGuiClients.length, 0);
});

check('mixed: external discovered, our ghost ignored', () => {
  const c = newClient();
  c._handleLine(S('75FFB914', 'client_id=0 station=POTACAT'));                                  // ghost
  c._handleLine(S('4E1DDC50', 'client_id=FC77859A-1111-2222-3333-444455556666 program=SmartSDR-Win')); // real
  assert.deepStrictEqual(c._discoveredGuiClients, ['FC77859A-1111-2222-3333-444455556666']);
});

check('discovering our ghost remembers its handle (so a later line still skips it)', () => {
  const c = newClient();
  c._handleLine(S('CAFEBABE', 'client_id=0 program=POTACAT'));  // recognized by program -> remember handle
  c._handleLine(S('CAFEBABE', 'client_id=0'));                  // same handle, no program this time
  assert.strictEqual(c._discoveredGuiClients.length, 0);
});

console.log(`\nSmartSDR discovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
