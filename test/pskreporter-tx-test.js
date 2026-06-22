#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
//
// PSKReporter ingest encoder regression. Run: node test/pskreporter-tx-test.js
//
// Validates the IPFIX framing by DECODING our own datagram with a minimal
// parser and checking it round-trips. This proves self-consistency (header,
// set lengths, template defs, varstrings, record layout) — it does NOT prove
// the live PSKReporter service accepts it (that's the on-air validation gate).

const assert = require('assert');
const P = require('../lib/pskreporter-tx');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// Minimal IPFIX parser (test-only) — walks sets, reads template defs, decodes records.
function parse(buf) {
  const out = {
    version: buf.readUInt16BE(0), length: buf.readUInt16BE(2),
    exportTime: buf.readUInt32BE(4), seq: buf.readUInt32BE(8), odid: buf.readUInt32BE(12),
    templates: {}, data: {},
  };
  let off = 16;
  while (off + 4 <= out.length) {
    const setId = buf.readUInt16BE(off);
    const setLen = buf.readUInt16BE(off + 2);
    const setEnd = off + setLen;
    let p = off + 4;
    if (setId === 2) {
      while (p + 4 <= setEnd) {
        const tid = buf.readUInt16BE(p);
        const fc = buf.readUInt16BE(p + 2);
        if (tid === 0) break;
        p += 4;
        const fields = [];
        for (let i = 0; i < fc; i++) {
          const idRaw = buf.readUInt16BE(p);
          const flen = buf.readUInt16BE(p + 2);
          if (idRaw & 0x8000) { fields.push({ ie: idRaw & 0x7fff, len: flen, ent: buf.readUInt32BE(p + 4) }); p += 8; }
          else { fields.push({ ie: idRaw, len: flen, ent: 0 }); p += 4; }
        }
        out.templates[tid] = fields;
      }
    } else if (setId >= 256) {
      const fields = out.templates[setId] || [];
      const recs = [];
      let dp = p;
      while (setEnd - dp >= 4) { // remaining >=4 means more than just padding
        const rec = {};
        for (const f of fields) {
          if (f.len === 0xffff) {
            let l = buf[dp]; dp += 1;
            if (l === 0xff) { l = buf.readUInt16BE(dp); dp += 2; }
            rec[f.ie] = buf.slice(dp, dp + l).toString('utf8'); dp += l;
          } else { rec[f.ie] = buf.slice(dp, dp + f.len); dp += f.len; }
        }
        recs.push(rec);
      }
      out.data[setId] = recs;
    }
    off = setEnd;
  }
  return out;
}

const RX = { call: 'K3SBP', grid: 'FN20', software: 'POTACAT 1.8.15', antenna: 'EFHW @ 30ft' };
const REPORTS = [
  { call: 'K1ABC', freqHz: 14074123, snr: -12, mode: 'FT8', grid: 'FN42', timeSec: 1781000000 },
  { call: 'VK7JJ', freqHz: 14075890, snr: -24, mode: 'FT8', grid: 'QE37', timeSec: 1781000060 },
  { call: 'W1AW', freqHz: 7048500, snr: 3, mode: 'FT4', grid: '', timeSec: 1781000120 },
];

check('varStr: short string = 1-byte length prefix', () => {
  const b = P.varStr('FT8');
  assert.strictEqual(b[0], 3);
  assert.strictEqual(b.slice(1).toString(), 'FT8');
  assert.strictEqual(P.varStr('')[0], 0);
});

check('makeSet pads to a 4-byte boundary and length includes padding', () => {
  const s = P.makeSet(0x50E2, Buffer.from([1, 2, 3])); // body 3 -> 4+3=7 -> pad to 8
  assert.strictEqual(s.length % 4, 0);
  assert.strictEqual(s.readUInt16BE(0), 0x50E2);
  assert.strictEqual(s.readUInt16BE(2), s.length);
});

check('datagram header: version, exact length, ids', () => {
  const d = P.encodeDatagram(RX, REPORTS, { exportTime: 1781000200, sequenceNumber: 7, observationDomainId: 0xABCDEF01 });
  const m = parse(d);
  assert.strictEqual(m.version, 0x000A);
  assert.strictEqual(m.length, d.length, 'header length must equal real length');
  assert.strictEqual(m.exportTime, 1781000200);
  assert.strictEqual(m.seq, 7);
  assert.strictEqual(m.odid >>> 0, 0xABCDEF01);
});

check('templates present with correct field counts', () => {
  const m = parse(P.encodeDatagram(RX, REPORTS, {}));
  assert.ok(m.templates[P.RX_TEMPLATE_ID], 'rx template defined');
  assert.ok(m.templates[P.TX_TEMPLATE_ID], 'tx template defined');
  assert.strictEqual(m.templates[P.RX_TEMPLATE_ID].length, 4);
  assert.strictEqual(m.templates[P.TX_TEMPLATE_ID].length, 7);
  // enterprise number on the PSKReporter fields
  assert.strictEqual(m.templates[P.RX_TEMPLATE_ID][0].ent, P.VENDOR);
});

check('receiver record round-trips', () => {
  const m = parse(P.encodeDatagram(RX, REPORTS, {}));
  const r = m.data[P.RX_TEMPLATE_ID][0];
  assert.strictEqual(r[P.IE.receiverCallsign], 'K3SBP');
  assert.strictEqual(r[P.IE.receiverLocator], 'FN20');
  assert.strictEqual(r[P.IE.decoderSoftware], 'POTACAT 1.8.15');
  assert.strictEqual(r[P.IE.antennaInformation], 'EFHW @ 30ft');
});

check('all reception reports round-trip (call/freq/snr/mode/grid/time)', () => {
  const m = parse(P.encodeDatagram(RX, REPORTS, {}));
  const recs = m.data[P.TX_TEMPLATE_ID];
  assert.strictEqual(recs.length, REPORTS.length, 'no spurious/padding records');
  REPORTS.forEach((rep, i) => {
    const r = recs[i];
    assert.strictEqual(r[P.IE.senderCallsign], rep.call);
    assert.strictEqual(r[P.IE.frequency].readUInt32BE(0), rep.freqHz);
    assert.strictEqual(r[P.IE.sNR].readInt8(0), rep.snr);
    assert.strictEqual(r[P.IE.mode], rep.mode);
    assert.strictEqual(r[P.IE.senderLocator], rep.grid);
    assert.strictEqual(r[P.IANA_FLOW_START_SECONDS].readUInt32BE(0), rep.timeSec);
    assert.strictEqual(r[P.IE.informationSource].readUInt8(0), 1);
  });
});

check('negative SNR encodes/decodes as signed byte', () => {
  const m = parse(P.encodeDatagram(RX, [{ call: 'X', freqHz: 1, snr: -28, mode: 'FT8', grid: '', timeSec: 1 }], {}));
  assert.strictEqual(m.data[P.TX_TEMPLATE_ID][0][P.IE.sNR].readInt8(0), -28);
});

check('empty report list -> valid datagram, zero records', () => {
  const m = parse(P.encodeDatagram(RX, [], {}));
  assert.strictEqual((m.data[P.TX_TEMPLATE_ID] || []).length, 0);
  assert.strictEqual(m.data[P.RX_TEMPLATE_ID].length, 1);
});

console.log(`\nPSKReporter encoder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
