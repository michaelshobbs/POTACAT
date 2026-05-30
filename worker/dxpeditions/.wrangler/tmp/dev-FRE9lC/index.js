var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-ZnQ0wb/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// index.js
var KV_KEY = "feed:v1";
var SCHEMA_VERSION = "1";
var FEED_TTL_DAYS = 60;
var USER_AGENT = "POTACAT-DXpeditions/1.0 (+https://potacat.com)";
var BLOCKLIST = /* @__PURE__ */ new Set([
  "IOTA",
  "SOTA",
  "POTA",
  "WWFF",
  "DXCC",
  "CQWW",
  "DXing",
  "IARU",
  "ITU",
  "WPX",
  "ARRL",
  "YOTA",
  "OQRS",
  "LOTW",
  "EQSL",
  "OPDX",
  "TDDX"
]);
var BARE_CALL_RE_1 = /^[A-Z][A-Z0-9]?\d[A-Z]{1,4}$/;
var BARE_CALL_RE_2 = /^\d[A-Z][A-Z0-9]?\d?[A-Z]{1,4}$/;
function isBareCall(s) {
  if (!s || s.length < 3 || s.length > 8) return false;
  return BARE_CALL_RE_1.test(s) || BARE_CALL_RE_2.test(s);
}
__name(isBareCall, "isBareCall");
async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml,text/xml,*/*" },
    cf: { cacheTtl: 60 },
    // dedupe back-to-back cron + edge-request traffic
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
__name(fetchUrl, "fetchUrl");
function parseRss(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while (m = itemRe.exec(xml)) {
    const body = m[1];
    const title = textOf(body, "title");
    const link = textOf(body, "link");
    const pubDate = textOf(body, "pubDate");
    const description = textOf(body, "description");
    if (!title) continue;
    items.push({ title, link, pubDate, description });
  }
  return items;
}
__name(parseRss, "parseRss");
function textOf(body, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = body.match(re);
  if (!m) return "";
  let s = m[1].trim();
  s = s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  return decodeEntities(s);
}
__name(textOf, "textOf");
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => {
    const code = parseInt(n, 10);
    return Number.isFinite(code) ? String.fromCharCode(code) : "";
  }).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
__name(decodeEntities, "decodeEntities");
function extractCallsigns(title) {
  if (!title) return [];
  const out = /* @__PURE__ */ new Set();
  const tokens = title.toUpperCase().split(/[^A-Z0-9/]+/);
  for (let tok of tokens) {
    if (!tok || tok.length < 3 || tok.length > 12) continue;
    if (BLOCKLIST.has(tok)) continue;
    if (tok.includes("/")) {
      const parts = tok.split("/").filter(Boolean);
      if (parts.length < 2 || parts.length > 3) continue;
      const hasBareCall = parts.some(isBareCall);
      if (!hasBareCall) continue;
      out.add(tok);
      for (const p of parts) if (isBareCall(p)) out.add(p);
    } else if (isBareCall(tok)) {
      out.add(tok);
    }
  }
  return [...out];
}
__name(extractCallsigns, "extractCallsigns");
var SOURCES = [
  {
    name: "dx-world",
    url: "https://dx-world.net/feed/",
    extract: /* @__PURE__ */ __name((item) => extractCallsigns(item.title), "extract")
  },
  {
    name: "dxnews",
    url: "https://dxnews.com/rss.xml",
    // DXNews titles lead with the call: "<CALL> <topic>. From DXNews.com".
    // The generic extractor lands on the lead token first; we accept any
    // additional bare-calls or slash-forms in the title for cases where
    // a single post covers multiple ops.
    extract: /* @__PURE__ */ __name((item) => extractCallsigns(item.title), "extract")
  },
  {
    name: "ng3k",
    url: "https://www.ng3k.com/adxo.xml",
    // NG3K title schema is canonical:
    //   "<Country>: <dates> -- <CALL> -- QSL via: <MANAGER>"
    // Pulling from the whole title would also pick up the QSL manager's
    // call (real callsign, but not the DXpedition op) — false positive.
    // Restrict to the call field between the first two "--" separators.
    extract: /* @__PURE__ */ __name((item) => {
      const parts = item.title.split(/\s*--\s*/);
      const window = parts.length >= 2 ? parts[1] : item.title;
      return extractCallsigns(window);
    }, "extract")
  }
];
function normalize(items, source, now) {
  const out = [];
  for (const it of items) {
    const calls = source.extract(it);
    if (!calls.length) continue;
    const published = parseDate(it.pubDate) || now;
    for (const call of calls) {
      out.push({
        call,
        title: it.title,
        link: it.link || "",
        publishedAt: new Date(published).toISOString(),
        source: source.name,
        firstSeen: now
      });
    }
  }
  return out;
}
__name(normalize, "normalize");
function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
__name(parseDate, "parseDate");
function mergeWithExisting(existing, fresh, now) {
  const byCall = /* @__PURE__ */ new Map();
  for (const r of existing || []) {
    if (!r || !r.call) continue;
    byCall.set(r.call, r);
  }
  for (const r of fresh) {
    const prev = byCall.get(r.call);
    if (!prev) {
      byCall.set(r.call, r);
      continue;
    }
    const sources = new Set(String(prev.source || "").split(",").filter(Boolean));
    sources.add(r.source);
    const prevPub = Date.parse(prev.publishedAt) || 0;
    const currPub = Date.parse(r.publishedAt) || 0;
    const newer = currPub > prevPub ? r : prev;
    byCall.set(r.call, {
      ...prev,
      title: newer.title,
      link: newer.link,
      publishedAt: newer.publishedAt,
      source: [...sources].sort().join(",")
    });
  }
  const cutoff = now - FEED_TTL_DAYS * 24 * 3600 * 1e3;
  return [...byCall.values()].filter((r) => r.firstSeen >= cutoff).sort((a, b) => b.firstSeen - a.firstSeen);
}
__name(mergeWithExisting, "mergeWithExisting");
function toJson(state) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    generated: new Date(state.generatedAt || Date.now()).toISOString(),
    count: state.records.length,
    sources: state.sources || {},
    records: state.records
  });
}
__name(toJson, "toJson");
function toXml(state) {
  const esc = /* @__PURE__ */ __name((s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"), "esc");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<dxpeditions version="${SCHEMA_VERSION}" generated="${esc(new Date(state.generatedAt || Date.now()).toISOString())}" count="${state.records.length}">`
  ];
  for (const r of state.records) {
    lines.push(
      `  <op call="${esc(r.call)}" published="${esc(r.publishedAt)}" firstSeen="${esc(new Date(r.firstSeen).toISOString())}" source="${esc(r.source)}">`,
      `    <title>${esc(r.title)}</title>`,
      `    <link>${esc(r.link)}</link>`,
      "  </op>"
    );
  }
  lines.push("</dxpeditions>");
  return lines.join("\n");
}
__name(toXml, "toXml");
async function readState(env) {
  const raw = await env.DXPEDITIONS.get(KV_KEY);
  if (!raw) return { records: [], generatedAt: 0, lastFetchedAt: 0, lastError: "", sources: {} };
  try {
    const parsed = JSON.parse(raw);
    parsed.sources = parsed.sources || {};
    return parsed;
  } catch {
    return { records: [], generatedAt: 0, lastFetchedAt: 0, lastError: "corrupt kv payload", sources: {} };
  }
}
__name(readState, "readState");
async function writeState(env, state) {
  await env.DXPEDITIONS.put(KV_KEY, JSON.stringify(state));
}
__name(writeState, "writeState");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Max-Age": "86400"
};
var worker = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    const url = new URL(request.url);
    const state = await readState(env);
    if (url.pathname === "/feeds/dxpeditions.xml") {
      return new Response(toXml(state), {
        headers: {
          ...CORS,
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
    if (url.pathname === "/feeds/dxpeditions.json") {
      return new Response(toJson(state), {
        headers: {
          ...CORS,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
    if (url.pathname === "/healthz") {
      const sourcesHealth = {};
      for (const [k, v] of Object.entries(state.sources || {})) {
        sourcesHealth[k] = {
          lastFetchedAt: v.lastFetchedAt ? new Date(v.lastFetchedAt).toISOString() : null,
          lastError: v.lastError || null,
          lastCount: v.lastCount || 0
        };
      }
      return new Response(
        JSON.stringify({
          ok: !state.lastError,
          schemaVersion: SCHEMA_VERSION,
          lastFetchedAt: state.lastFetchedAt ? new Date(state.lastFetchedAt).toISOString() : null,
          generatedAt: state.generatedAt ? new Date(state.generatedAt).toISOString() : null,
          count: state.records.length,
          lastError: state.lastError || null,
          sources: sourcesHealth
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  },
  // Cron handler — fetch each registered source independently, merge their
  // outputs, write back to KV.
  //
  // Per-source failure does NOT bubble: it gets recorded in
  // sources[name].lastError but other sources still run and the merge
  // proceeds with whatever did succeed. Only when ALL sources fail do we
  // preserve the previous payload unchanged.
  async scheduled(_event, env, _ctx) {
    const now = Date.now();
    const prev = await readState(env);
    const sources = { ...prev.sources || {} };
    const allFresh = [];
    let anyOk = false;
    for (const src of SOURCES) {
      try {
        const xml = await fetchUrl(src.url);
        const items = parseRss(xml);
        const fresh = normalize(items, src, now);
        allFresh.push(...fresh);
        sources[src.name] = { lastFetchedAt: now, lastError: "", lastCount: fresh.length };
        anyOk = true;
      } catch (err) {
        const prevSrc = sources[src.name] || {};
        sources[src.name] = {
          lastFetchedAt: now,
          lastError: String(err && err.message ? err.message : err),
          lastCount: prevSrc.lastCount || 0
        };
      }
    }
    const failures = Object.entries(sources).filter(([_, s]) => s.lastError);
    const topError = !anyOk ? failures.map(([n, s]) => `${n}: ${s.lastError}`).join("; ") : "";
    const merged = anyOk ? mergeWithExisting(prev.records, allFresh, now) : prev.records || [];
    await writeState(env, {
      records: merged,
      generatedAt: anyOk ? now : prev.generatedAt || 0,
      lastFetchedAt: now,
      lastError: topError,
      sources
    });
  },
  // Exposed so the temporary __bootstrap-cron endpoint (if re-added) can
  // call into the same code path as the real cron without duplicating logic.
  _SOURCES: SOURCES
};
var index_default = worker;

// C:/Users/cssta/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/cssta/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// .wrangler/tmp/bundle-ZnQ0wb/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default
];
var middleware_insertion_facade_default = index_default;

// C:/Users/cssta/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ZnQ0wb/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker2) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker2;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker2.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker2.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker2,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker2.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker2.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
