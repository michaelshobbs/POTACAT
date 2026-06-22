// SPDX-License-Identifier: Apache-2.0
// Copyright 2024-2026 Casey Stanton
//
// PSKReporter ingest encoder — report the FT8/FT4 decodes our station hears to
// pskreporter.info, the same way WSJT-X does. PSKReporter's ingest is an
// IPFIX-over-UDP binary protocol (NOT a simple HTTP POST), sent to
// report.pskreporter.info:4739. This module is the PURE encoder; the UDP send
// + batching lives in main.js.
//
// Clean-room from the documented PSKReporter format (pskreporter.info/pskdev.html).
// Information elements live under PSKReporter's IANA Private Enterprise Number
// 30351; flowStartSeconds is the standard IANA element 150.
//
// !!! VALIDATION GATE !!!  The framing here is self-consistent and unit-tested
// (test/pskreporter-tx-test.js decodes our own output), but acceptance by the
// live PSKReporter service can only be confirmed on the air: send real reports
// and check that your callsign appears at pskreporter.info within ~5 min. Until
// that's confirmed, the feature is OFF by default and can target the TEST port
// (14739). The field IDs/constants are isolated below so any needed correction
// is a one-line change. (Same posture as the WSPR encoder's wsprd loopback.)

const VERSION = 0x000A;            // IPFIX
const VENDOR = 30351;              // PSKReporter IANA Private Enterprise Number
const RX_TEMPLATE_ID = 0x50E1;     // our receiver-info template id (>255)
const TX_TEMPLATE_ID = 0x50E2;     // our reception-report template id (>255)

// PSKReporter information elements (enterprise 30351 unless marked IANA):
//   1 senderCallsign   2 receiverCallsign  3 senderLocator   4 receiverLocator
//   5 frequency        6 sNR               8 decoderSoftware 9 antennaInformation
//   10 mode            11 informationSource           IANA 150 flowStartSeconds
const IE = {
  senderCallsign: 1, receiverCallsign: 2, senderLocator: 3, receiverLocator: 4,
  frequency: 5, sNR: 6, decoderSoftware: 8, antennaInformation: 9,
  mode: 10, informationSource: 11,
};
const IANA_FLOW_START_SECONDS = 150;
const VARLEN = 0xFFFF;

// ---- low-level encoders -------------------------------------------------

// IPFIX variable-length string: 1-byte length when <255, else 0xFF + 2-byte length.
function varStr(s) {
  const b = Buffer.from(String(s == null ? '' : s), 'utf8');
  if (b.length < 255) return Buffer.concat([Buffer.from([b.length]), b]);
  const hdr = Buffer.alloc(3); hdr[0] = 0xFF; hdr.writeUInt16BE(b.length, 1);
  return Buffer.concat([hdr, b]);
}

// Field specifier for an enterprise IE: id|0x8000 (2) + length (2) + PEN (4).
function entField(ie, len) {
  const b = Buffer.alloc(8);
  b.writeUInt16BE(0x8000 | ie, 0);
  b.writeUInt16BE(len, 2);
  b.writeUInt32BE(VENDOR, 4);
  return b;
}
// Field specifier for a standard IANA IE: id (2) + length (2).
function ianaField(ie, len) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(ie, 0);
  b.writeUInt16BE(len, 2);
  return b;
}

// Wrap a body in a Set: setId (2) + length-incl-padding (2) + body, padded to 4.
function makeSet(setId, body) {
  let buf = Buffer.concat([Buffer.alloc(4), body]);
  const rem = buf.length % 4;
  if (rem) buf = Buffer.concat([buf, Buffer.alloc(4 - rem)]);
  buf.writeUInt16BE(setId, 0);
  buf.writeUInt16BE(buf.length, 2); // length INCLUDES padding so parsers walk correctly
  return buf;
}

// ---- templates ----------------------------------------------------------

function receiverTemplate() {
  const fields = Buffer.concat([
    entField(IE.receiverCallsign, VARLEN),
    entField(IE.receiverLocator, VARLEN),
    entField(IE.decoderSoftware, VARLEN),
    entField(IE.antennaInformation, VARLEN),
  ]);
  const hdr = Buffer.alloc(4);
  hdr.writeUInt16BE(RX_TEMPLATE_ID, 0);
  hdr.writeUInt16BE(4, 2); // field count
  return Buffer.concat([hdr, fields]);
}

function senderTemplate() {
  const fields = Buffer.concat([
    entField(IE.senderCallsign, VARLEN),
    entField(IE.frequency, 4),
    entField(IE.sNR, 1),
    entField(IE.mode, VARLEN),
    entField(IE.informationSource, 1),
    ianaField(IANA_FLOW_START_SECONDS, 4),
    entField(IE.senderLocator, VARLEN),
  ]);
  const hdr = Buffer.alloc(4);
  hdr.writeUInt16BE(TX_TEMPLATE_ID, 0);
  hdr.writeUInt16BE(7, 2); // field count
  return Buffer.concat([hdr, fields]);
}

// ---- data records -------------------------------------------------------

function receiverRecord(rx) {
  return Buffer.concat([
    varStr(rx.call), varStr(rx.grid),
    varStr(rx.software || 'POTACAT'), varStr(rx.antenna || ''),
  ]);
}

function senderRecord(rep) {
  const freq = Buffer.alloc(4); freq.writeUInt32BE((Number(rep.freqHz) || 0) >>> 0, 0);
  const snr = Buffer.alloc(1); snr.writeInt8(Math.max(-128, Math.min(127, Math.round(rep.snr || 0))), 0);
  const src = Buffer.from([1]); // informationSource: 1 = automatically derived by a receiver
  const time = Buffer.alloc(4); time.writeUInt32BE((Number(rep.timeSec) || 0) >>> 0, 0);
  return Buffer.concat([
    varStr(rep.call), freq, snr, varStr(rep.mode || 'FT8'), src, time, varStr(rep.grid || ''),
  ]);
}

/**
 * Build a full IPFIX datagram: header + template set + receiver record +
 * reception reports. Templates are re-sent every datagram (PSKReporter expects
 * this so a stateless receiver can decode any single packet).
 *
 * @param {object} rx      { call, grid, software?, antenna? }
 * @param {Array}  reports [{ call, freqHz, snr, mode, grid?, timeSec }]
 * @param {object} opts    { exportTime?, sequenceNumber?, observationDomainId? }
 * @returns {Buffer}
 */
function encodeDatagram(rx, reports, opts = {}) {
  const tSet = makeSet(2, Buffer.concat([receiverTemplate(), senderTemplate()]));
  const rxSet = makeSet(RX_TEMPLATE_ID, receiverRecord(rx));
  const txSet = makeSet(TX_TEMPLATE_ID, Buffer.concat((reports || []).map(senderRecord)));
  const msg = Buffer.concat([Buffer.alloc(16), tSet, rxSet, txSet]);
  msg.writeUInt16BE(VERSION, 0);
  msg.writeUInt16BE(msg.length, 2);
  msg.writeUInt32BE((opts.exportTime != null ? opts.exportTime : Math.floor(Date.now() / 1000)) >>> 0, 4);
  msg.writeUInt32BE((opts.sequenceNumber || 0) >>> 0, 8);
  msg.writeUInt32BE((opts.observationDomainId || 0) >>> 0, 12);
  return msg;
}

module.exports = {
  encodeDatagram, varStr, makeSet,
  VERSION, VENDOR, RX_TEMPLATE_ID, TX_TEMPLATE_ID, IE, IANA_FLOW_START_SECONDS,
};
