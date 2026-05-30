# potacat-dxpeditions

Cloudflare Worker that aggregates active and upcoming DXpeditions from
public community sources and serves a single canonical feed. POTACAT
desktop subscribes to this feed so users get auto-highlighted callsigns
for active operations without having to maintain the list themselves.

## v2 sources

Each source is scraped on every cron run; failures are isolated per
source (one outage doesn't stop the others).

| Source | URL | Format | Notes |
|---|---|---|---|
| DX-World | `https://dx-world.net/feed/` | RSS | Lead-callsign titles, multi-call posts split. |
| DXNews   | `https://dxnews.com/rss.xml` | RSS | Lead-callsign titles incl. PREFIX/CALL forms. |
| NG3K ADXO | `https://www.ng3k.com/adxo.xml` | RSS | Canonical title schema; extractor narrows to the call field to skip the QSL manager. |

Add a source: append `{ name, url, extract }` to the `SOURCES` array in
`index.js`. The `extract` callback receives a parsed item
`{ title, link, pubDate, description }` and returns an array of
callsigns. For most RSS feeds `extractCallsigns(item.title)` is enough;
sources whose title format includes non-op callsigns (e.g. NG3K's QSL
manager) need a narrower extractor.

Considered but deferred:
- **ARRL Special Event calendar** — different category (SES, not DX);
  belongs in a sibling feed.
- **NG3K HTML page** — superseded by their canonical RSS at adxo.xml.
- **ham365.net** — data loads client-side; no backend endpoint to scrape.

## Endpoints

| Path | Purpose |
|---|---|
| `GET /feeds/dxpeditions.xml` | Public XML feed (RSS-reader friendly). |
| `GET /feeds/dxpeditions.json` | Same data, JSON. Desktop client uses this. |
| `GET /healthz` | `{ ok, schemaVersion, lastFetchedAt, generatedAt, count, lastError, sources: { name: { lastFetchedAt, lastError, lastCount }}}` for monitoring. |

CORS is wide-open (`*`) — output is public DXpedition info.

## Schema (v1)

```jsonc
{
  "version": "1",
  "generated": "<ISO 8601>",
  "count": <int>,
  "records": [
    {
      "call": "FT4WC",                     // primary callsign (always uppercase)
      "title": "FT4WC – Crozet Island …",  // human-readable headline from the source
      "link": "https://dx-world.net/…",    // source story URL
      "publishedAt": "<ISO 8601>",         // source's pubDate, or first-seen if missing
      "firstSeen": <epoch ms>,             // when this worker first picked it up
      "source": "dx-world,ng3k"       // comma-joined when corroborated across sources
    },
    …
  ]
}
```

Records are sorted newest-firstSeen first. Records older than
**60 days** since firstSeen are dropped on the next cron run.

XML is a direct projection of the JSON; the schema version attribute
matches.

## Deploying

```sh
cd worker/dxpeditions

# One-time: create KV namespace, then paste its `id` into wrangler.toml
wrangler kv:namespace create DXPEDITIONS

# Deploy
wrangler deploy
```

The route binding (`dxpeditions.potacat.com/*`) assumes the apex zone
`potacat.com` already exists in your Cloudflare account.

## Operating

- Cron fires `0 */6 * * *` (4×/day, UTC).
- The HTTP handler **always** reads from KV — it never blocks on a
  live fetch. If a cron run fails (DX-World down, parse error, etc.),
  the previous payload keeps serving and `/healthz` exposes the error.
- KV writes are tiny (a few KB) and infrequent — well inside the free
  tier.

## Manual smoke test (no deploy)

After updating, run `node --check index.js` for a syntax pass. The
parser is regex-based and has no external deps, so a Node script that
calls `fetchDxWorld()` and prints `normalize(…)` is enough to validate
new RSS quirks before redeploy.

## Client-side TODO (POTACAT desktop)

When the worker is live:

1. Add `enableCommunityDxpeditions` setting (default false).
2. Settings → Watchlist tab: toggle + "Last refreshed: …" / Refresh button.
3. Add `main.js` poller (every 12h, on enable, on explicit Refresh) that
   `GET`s `/feeds/dxpeditions.json` and stores the parsed records in
   `settings.communityDxpeditions = { fetchedAt, version, records }`.
4. In `renderer/app.js`, extend `rebuildWatchlistGroupLookup()` (or a
   sibling function) so community records appear as a virtual watchlist
   group — own color, 🌐 emoji, "from DX-World" tooltip. Users can't
   edit it; they can only enable/disable the whole feed.
