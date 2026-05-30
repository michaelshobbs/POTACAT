var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-QSCJsu/checked-fetch.js
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
var DXWORLD_FEED = "https://dx-world.net/feed/";
var KV_KEY = "feed:v1";
var SCHEMA_VERSION = "1";
var FEED_TTL_DAYS = 60;
var USER_AGENT = "POTACAT-DXpeditions/1.0 (+https://potacat.com)";
var CALLSIGN_RE = /\b([A-Z][A-Z0-9]?[0-9][A-Z]{1,4})(\/[A-Z0-9]+)?\b/g;
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
  "OQRS"
]);
async function fetchDxWorld() {
  const res = await fetch(DXWORLD_FEED, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml,text/xml,*/*" },
    cf: { cacheTtl: 60 }
    // dedupe back-to-back cron + fetch traffic at the edge
  });
  if (!res.ok) throw new Error(`dx-world feed HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml);
}
__name(fetchDxWorld, "fetchDxWorld");
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
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;/g, "'").replace(/&#8211;/g, "\u2013");
  return s;
}
__name(textOf, "textOf");
function extractCallsign(title) {
  const matches = title.toUpperCase().matchAll(CALLSIGN_RE);
  for (const m of matches) {
    const base = m[1];
    if (BLOCKLIST.has(base)) continue;
    if (!/[A-Z]\d[A-Z]/.test(base)) continue;
    return base;
  }
  return null;
}
__name(extractCallsign, "extractCallsign");
function normalize(items, sourceName, now) {
  const out = [];
  for (const it of items) {
    const call = extractCallsign(it.title);
    if (!call) continue;
    const published = parseDate(it.pubDate) || now;
    out.push({
      call,
      title: it.title,
      link: it.link || "",
      publishedAt: new Date(published).toISOString(),
      source: sourceName,
      firstSeen: now
    });
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
    if (prev) {
      byCall.set(r.call, { ...prev, title: r.title, link: r.link, publishedAt: r.publishedAt, source: r.source });
    } else {
      byCall.set(r.call, r);
    }
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
  if (!raw) return { records: [], generatedAt: 0, lastFetchedAt: 0, lastError: "" };
  try {
    return JSON.parse(raw);
  } catch {
    return { records: [], generatedAt: 0, lastFetchedAt: 0, lastError: "corrupt kv payload" };
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
var index_default = {
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
          // Edge-cache 1h. Worker updates KV via cron, so a stale edge
          // cache is at worst 1h behind the KV — fine for daily-cadence
          // DXpedition announcements.
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
      return new Response(
        JSON.stringify({
          ok: !state.lastError,
          schemaVersion: SCHEMA_VERSION,
          lastFetchedAt: state.lastFetchedAt ? new Date(state.lastFetchedAt).toISOString() : null,
          generatedAt: state.generatedAt ? new Date(state.generatedAt).toISOString() : null,
          count: state.records.length,
          lastError: state.lastError || null
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  },
  // Cron handler — fetch DX-World, merge, write back to KV.
  // Failures are absorbed: we update lastError but DO NOT clobber the
  // previous records[], so the public feed keeps serving last-known-good.
  async scheduled(_event, env, _ctx) {
    const now = Date.now();
    const prev = await readState(env);
    try {
      const items = await fetchDxWorld();
      const fresh = normalize(items, "dx-world", now);
      const merged = mergeWithExisting(prev.records, fresh, now);
      await writeState(env, {
        records: merged,
        generatedAt: now,
        lastFetchedAt: now,
        lastError: ""
      });
    } catch (err) {
      await writeState(env, {
        records: prev.records || [],
        generatedAt: prev.generatedAt || 0,
        lastFetchedAt: now,
        lastError: String(err && err.message ? err.message : err)
      });
    }
  }
};

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

// .wrangler/tmp/bundle-QSCJsu/middleware-insertion-facade.js
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

// .wrangler/tmp/bundle-QSCJsu/middleware-loader.entry.ts
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
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
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
