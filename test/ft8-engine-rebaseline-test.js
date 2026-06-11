#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
//
// FT8 engine unit tests for the 2026-06-10 changes:
//   - reBaseline(): live clock-correction recovery (no app restart)
//   - per-mode RX buffer = exactly one T/R period (FT2 45600, not 45000)
//
// Constructs the engine WITHOUT start(), so no worker thread / native addon is
// spawned. Run:  node test/ft8-engine-rebaseline-test.js
// =====================================================================

const { Ft8Engine } = require('../lib/ft8-engine');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (expected ${b}, got ${a})`); }
function section(n) { console.log('\n=== ' + n + ' ==='); }

// ---------------------------------------------------------------------
section('Per-mode RX buffer = one T/R period (Fix #5)');
{
  const e = new Ft8Engine();
  eq(e._audioBuffer.length, 180000, 'FT8 buffer = 15s @ 12kHz');
  e.setMode('FT4');
  eq(e._audioBuffer.length, 90000, 'FT4 buffer = 7.5s @ 12kHz');
  e.setMode('FT2');
  eq(e._audioBuffer.length, 45600, 'FT2 buffer = 3.8s @ 12kHz (was 45000/3.75s)');
  e.setMode('FT8');
  eq(e._audioBuffer.length, 180000, 'back to FT8 buffer');
}

// ---------------------------------------------------------------------
section('reBaseline() resets stale-clock state (Fix #3)');
{
  const e = new Ft8Engine();
  e._running = true; // simulate a started engine without spawning a worker

  // Dirty every value a clock step poisons.
  e._audioBuffer.fill(0.5);
  e._audioOffset = 12345;
  e._samplesSinceCycle = 99999;
  e._lastCycleFireSlot = 42;
  e._lastTxFireSlot = 41;
  e._audioLatencyMedians = [1.2, 1.3, 1.25];
  e._audioLatencyAuto = true;
  e._audioLatencyMs = 2000;
  e._lastRxSlot = 'even';
  e._lockedTxSlot = 'odd';
  e._silentCycles = 2;
  e._silentRestarts = 1;
  e._lastWorkerResponseMs = 1; // ancient -> would trip watchdog

  let latencyEvt = null, statusEvt = null;
  e.on('audio-latency-changed', (d) => { latencyEvt = d; });
  e.on('status', (d) => { statusEvt = d; });

  e.reBaseline();

  ok(e._audioBuffer.every((v) => v === 0), 'audio buffer flushed to zero');
  eq(e._audioOffset, 0, 'audio offset reset');
  eq(e._samplesSinceCycle, 0, 'samples-since-cycle reset');
  eq(e._lastCycleFireSlot, -1, 'cycle-fire dedupe re-armed');
  eq(e._lastTxFireSlot, -1, 'tx-fire dedupe re-armed');
  eq(e._audioLatencyMedians.length, 0, 'latency medians cleared');
  eq(e._audioLatencyMs, 0, 'auto latency reset to 0');
  eq(e._lastRxSlot, null, 'rx slot parity cleared');
  eq(e._lockedTxSlot, null, 'locked tx slot cleared');
  eq(e._silentCycles, 0, 'silent-cycle counter cleared');
  eq(e._silentRestarts, 0, 'silent-restart counter cleared');
  ok(e._lastWorkerResponseMs > 1, 'worker watchdog timestamp re-seeded to now');
  ok(latencyEvt && latencyEvt.ms === 0 && latencyEvt.auto === true, 'emitted audio-latency-changed {0, auto}');
  ok(statusEvt && statusEvt.rebaselined === true, 'emitted status {rebaselined:true}');
}

section('reBaseline() respects a manual latency pin and the not-running guard');
{
  const e = new Ft8Engine();
  e._running = true;
  e._audioLatencyAuto = false; // user pinned a value
  e._audioLatencyMs = 1500;
  e.reBaseline();
  eq(e._audioLatencyMs, 1500, 'manual latency pin preserved across re-baseline');

  const e2 = new Ft8Engine();
  e2._running = false; // not started
  e2._audioOffset = 777;
  e2.reBaseline();
  eq(e2._audioOffset, 777, 'no-op when engine not running');
}

// ---------------------------------------------------------------------
console.log('\n============================================================');
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES PRESENT'); process.exit(1); }
console.log('All engine tests passed.');
