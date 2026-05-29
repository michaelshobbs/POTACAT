// potacat-dxpeditions — Cloudflare Worker
//
// Aggregates active / upcoming DXpeditions from public sources and serves
// a single canonical feed that POTACAT desktop clients can subscribe to.
//
// v1 sources:
//   - DX-World RSS (https://dx-world.net/feed/)
//
// Cron runs every 6h: fetch sources, normalize/dedupe, store JSON in KV.
// HTTP handler reads from KV (always the last successful fetch — if cron
// fails or DX-World is down, clients keep getting the previous payload
// rather than 404s).
//
// Endpoints:
//   GET /feeds/dxpeditions.xml   — custom XML schema (see toXml below)
//   GET /feeds/dxpeditions.json  — same data, JSON. Easier for the client
//                                  to parse; XML is for RSS-reader compat.
//   GET /healthz                 — { ok, lastFetchedAt, lastError, count }
//
// CORS: open (`*`). Output is public DXpedition info; no auth needed.

const DXWORLD_FEED = 'https://dx-world.net/feed/';
const KV_KEY = 'feed:v1';
const SCHEMA_VERSION = '1';
const FEED_TTL_DAYS = 60; // drop records this many days after first seen
const USER_AGENT = 'POTACAT-DXpeditions/1.0 (+https://potacat.com)';

// Callsign in DX-World titles. Same shape as donors worker's regex but
// broadened: any prefix letter set, optional second letter, region digit,
// 1-4 suffix letters, optional /portable suffix. Anchored at word
// boundaries so we don't grab fragments inside dates / regular words.
const CALLSIGN_RE = /\b([A-Z][A-Z0-9]?[0-9][A-Z]{1,4})(\/[A-Z0-9]+)?\b/g;

// Words that look like callsigns but aren't. RSS titles tend to include
// expedition codenames like "AS-104" (IOTA) or "EU-013" — filter out.
const BLOCKLIST = new Set([
  'IOTA', 'SOTA', 'POTA', 'WWFF', 'DXCC', 'CQWW', 'DXing', 'IARU',
  'ITU', 'WPX', 'ARRL', 'YOTA', 'OQRS',
]);

// ---------- DX-World fetch + parse ----------

async function fetchDxWorld() {
  const res = await fetch(DXWORLD_FEED, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml,text/xml,*/*' },
    cf: { cacheTtl: 60 }, // dedupe back-to-back cron + fetch traffic at the edge
  });
  if (!res.ok) throw new Error(`dx-world feed HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml);
}

// Tiny regex-based RSS parser. Avoids pulling a real XML parser into the
// Worker — the feed is well-formed, and we only need <item> fields.
function parseRss(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const body = m[1];
    const title = textOf(body, 'title');
    const link = textOf(body, 'link');
    const pubDate = textOf(body, 'pubDate');
    const description = textOf(body, 'description');
    if (!title) continue;
    items.push({ title, link, pubDate, description });
  }
  return items;
}

function textOf(body, tag) {
  // Strip CDATA wrappers, decode the small set of named entities RSS uses.
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = body.match(re);
  if (!m) return '';
  let s = m[1].trim();
  s = s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;/g, "'").replace(/&#8211;/g, '–');
  return s;
}

function extractCallsign(title) {
  // DX-World titles usually lead with the callsign: "FT4WC – Crozet Island…"
  // or "Vietnam – XV9NPS, XV9XJP". Pull the first plausible callsign that
  // contains at least one digit AND at least one letter AFTER the digit
  // (a real callsign suffix), and isn't on the blocklist.
  const matches = title.toUpperCase().matchAll(CALLSIGN_RE);
  for (const m of matches) {
    const base = m[1];
    if (BLOCKLIST.has(base)) continue;
    if (!/[A-Z]\d[A-Z]/.test(base)) continue; // require letter-digit-letter pattern
    return base;
  }
  return null;
}

// ---------- Normalize / merge ----------

function normalize(items, sourceName, now) {
  const out = [];
  for (const it of items) {
    const call = extractCallsign(it.title);
    if (!call) continue;
    const published = parseDate(it.pubDate) || now;
    out.push({
      call,
      title: it.title,
      link: it.link || '',
      publishedAt: new Date(published).toISOString(),
      source: sourceName,
      firstSeen: now,
    });
  }
  return out;
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// Merge new records with existing KV state. Preserves firstSeen of records
// the client has already been told about (so client-side max-age windows
// stay stable across cron runs) and drops anything past FEED_TTL_DAYS.
function mergeWithExisting(existing, fresh, now) {
  const byCall = new Map();
  // Seed with the previous payload so historical firstSeen sticks.
  for (const r of existing || []) {
    if (!r || !r.call) continue;
    byCall.set(r.call, r);
  }
  for (const r of fresh) {
    const prev = byCall.get(r.call);
    if (prev) {
      // Keep the earliest firstSeen, refresh the title/link/source to the
      // newest occurrence in case DX-World rewrites a post.
      byCall.set(r.call, { ...prev, title: r.title, link: r.link, publishedAt: r.publishedAt, source: r.source });
    } else {
      byCall.set(r.call, r);
    }
  }
  const cutoff = now - FEED_TTL_DAYS * 24 * 3600 * 1000;
  return [...byCall.values()]
    .filter((r) => r.firstSeen >= cutoff)
    .sort((a, b) => b.firstSeen - a.firstSeen);
}

// ---------- Output ----------

function toJson(state) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    generated: new Date(state.generatedAt || Date.now()).toISOString(),
    count: state.records.length,
    records: state.records,
  });
}

function toXml(state) {
  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<dxpeditions version="${SCHEMA_VERSION}" generated="${esc(new Date(state.generatedAt || Date.now()).toISOString())}" count="${state.records.length}">`,
  ];
  for (const r of state.records) {
    lines.push(
      `  <op call="${esc(r.call)}" published="${esc(r.publishedAt)}" firstSeen="${esc(new Date(r.firstSeen).toISOString())}" source="${esc(r.source)}">`,
      `    <title>${esc(r.title)}</title>`,
      `    <link>${esc(r.link)}</link>`,
      '  </op>',
    );
  }
  lines.push('</dxpeditions>');
  return lines.join('\n');
}

// ---------- KV state ----------

async function readState(env) {
  const raw = await env.DXPEDITIONS.get(KV_KEY);
  if (!raw) return { records: [], generatedAt: 0, lastFetchedAt: 0, lastError: '' };
  try {
    return JSON.parse(raw);
  } catch {
    return { records: [], generatedAt: 0, lastFetchedAt: 0, lastError: 'corrupt kv payload' };
  }
}

async function writeState(env, state) {
  await env.DXPEDITIONS.put(KV_KEY, JSON.stringify(state));
}

// ---------- HTTP handler ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

    const url = new URL(request.url);
    const state = await readState(env);

    if (url.pathname === '/feeds/dxpeditions.xml') {
      return new Response(toXml(state), {
        headers: {
          ...CORS,
          'Content-Type': 'application/xml; charset=utf-8',
          // Edge-cache 1h. Worker updates KV via cron, so a stale edge
          // cache is at worst 1h behind the KV — fine for daily-cadence
          // DXpedition announcements.
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    if (url.pathname === '/feeds/dxpeditions.json') {
      return new Response(toJson(state), {
        headers: {
          ...CORS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    if (url.pathname === '/healthz') {
      return new Response(
        JSON.stringify({
          ok: !state.lastError,
          schemaVersion: SCHEMA_VERSION,
          lastFetchedAt: state.lastFetchedAt
            ? new Date(state.lastFetchedAt).toISOString()
            : null,
          generatedAt: state.generatedAt
            ? new Date(state.generatedAt).toISOString()
            : null,
          count: state.records.length,
          lastError: state.lastError || null,
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not Found', { status: 404 });
  },

  // Cron handler — fetch DX-World, merge, write back to KV.
  // Failures are absorbed: we update lastError but DO NOT clobber the
  // previous records[], so the public feed keeps serving last-known-good.
  async scheduled(_event, env, _ctx) {
    const now = Date.now();
    const prev = await readState(env);
    try {
      const items = await fetchDxWorld();
      const fresh = normalize(items, 'dx-world', now);
      const merged = mergeWithExisting(prev.records, fresh, now);
      await writeState(env, {
        records: merged,
        generatedAt: now,
        lastFetchedAt: now,
        lastError: '',
      });
    } catch (err) {
      // Bump lastFetchedAt so /healthz reflects the attempt; keep records.
      await writeState(env, {
        records: prev.records || [],
        generatedAt: prev.generatedAt || 0,
        lastFetchedAt: now,
        lastError: String(err && err.message ? err.message : err),
      });
    }
  },
};
