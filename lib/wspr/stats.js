// SPDX-License-Identifier: Apache-2.0
// Copyright 2024-2026 Casey Stanton
//
// WSPR session statistics — pure computation over the spot list. WSPR's whole
// point is the DATA: how far, how many, how little power. This turns the raw
// spots into the numbers that make the mode worth running.
//
// Dual-mode like cq-target.js: Node `require()` gets module.exports; the popout
// renderer (no require) loads it via <script> as window.WsprStats. No DOM/Node
// deps, so it's safe in both and unit-tested in node.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WsprStats = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // dBm -> watts (the spotted station's reported TX power).
  function dbmToWatts(dbm) {
    return Math.pow(10, (Number(dbm) - 30) / 10);
  }

  /**
   * Summarize a list of WSPR spots.
   * @param {Array} spots  { call, grid, dBm, snr, distanceMi, bearing, entity, continent }
   * @returns {object} counts, best DX, best miles-per-watt, SNR range.
   */
  function computeWsprStats(spots) {
    spots = Array.isArray(spots) ? spots : [];
    var calls = {}, grids = {}, entities = {}, continents = {};
    var bestDx = null, bestMpw = null, weakest = null;
    var snrSum = 0, snrCount = 0, snrMax = -Infinity;

    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      if (!s) continue;
      if (s.call) calls[s.call] = 1;
      if (s.grid) grids[s.grid] = 1;
      if (s.entity) entities[s.entity] = 1;
      if (s.continent) continents[s.continent] = 1;

      if (typeof s.distanceMi === 'number' && s.distanceMi >= 0) {
        if (!bestDx || s.distanceMi > bestDx.distanceMi) bestDx = s;
        if (typeof s.dBm === 'number') {
          var w = dbmToWatts(s.dBm);
          if (w > 0) {
            var mpw = s.distanceMi / w;
            if (!bestMpw || mpw > bestMpw._mpw) { bestMpw = clone(s); bestMpw._mpw = mpw; bestMpw._watts = w; }
          }
        }
      }
      if (typeof s.snr === 'number') {
        snrSum += s.snr; snrCount++;
        if (s.snr > snrMax) snrMax = s.snr;
        if (!weakest || s.snr < weakest.snr) weakest = s;
      }
    }

    return {
      spots: spots.length,
      uniqueCalls: count(calls),
      uniqueGrids: count(grids),
      uniqueEntities: count(entities),
      uniqueContinents: count(continents),
      bestDx: bestDx ? {
        call: bestDx.call, grid: bestDx.grid, distanceMi: Math.round(bestDx.distanceMi),
        bearing: bestDx.bearing, entity: bestDx.entity || null,
      } : null,
      bestMpw: bestMpw ? {
        call: bestMpw.call, distanceMi: Math.round(bestMpw.distanceMi), dBm: bestMpw.dBm,
        watts: bestMpw._watts, milesPerWatt: Math.round(bestMpw._mpw),
      } : null,
      snrAvg: snrCount ? Math.round(snrSum / snrCount) : null,
      snrBest: snrCount ? snrMax : null,
      weakest: weakest ? { call: weakest.call, snr: weakest.snr } : null,
    };
  }

  /** Format miles-per-watt compactly (e.g. 11200 -> "11.2k mi/W"). */
  function formatMpw(mpw) {
    if (mpw == null) return '';
    return mpw >= 1000 ? (mpw / 1000).toFixed(1) + 'k mi/W' : Math.round(mpw) + ' mi/W';
  }

  function count(o) { return Object.keys(o).length; }
  function clone(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }

  return { computeWsprStats: computeWsprStats, dbmToWatts: dbmToWatts, formatMpw: formatMpw };
}));
