# Architecture

## Layers

```
src/
├── index.ts            entry: stdio (default) or --http
├── server.ts           createServer() — registers tools/resources/prompts
├── context.ts          AppContext: config + logger + cache + registry + analytics
├── config.ts           env → typed Config, validated at startup
├── logger.ts           stderr JSON logs + ring buffer for the dashboard
├── errors.ts           typed errors → LLM-actionable messages
│
├── providers/          ← data sources live here, one directory each
│   ├── types.ts        HumanitarianProvider contract + NormalizedRecord
│   ├── registry.ts     lookup by dataset; tools never import providers
│   ├── unhcr/          client.ts · codes.ts · normalize.ts · index.ts
│   ├── worldbank/      client.ts · normalize.ts · index.ts (context indicators)
│   ├── hdx/            client.ts · normalize.ts · index.ts (4 HAPI themes)
│   └── reliefweb/      documented stub — help wanted
│
├── shared/             cross-provider infrastructure
│   ├── http.ts         fetch + retry + backoff + ETag + SWR + offline
│   ├── rate-limiter.ts token bucket per provider
│   ├── country-match.ts fuzzy name scoring, Arabic-aware (provider-reusable)
│   ├── country-names-ar.ts Arabic names/aliases per ISO3
│   ├── stats.ts        regression, YoY, CAGR, anomaly detection
│   ├── analytics.ts    in-memory usage counters (dashboard)
│   └── geo.ts          ISO3 → centroid table for GeoJSON
│
├── cache/              Cache interface · memory (LRU) · sqlite (node:sqlite)
├── schemas/            shared zod fragments for tool I/O
├── tools/              20 tools in focused files + common.ts, denominators.ts, codebook.ts
├── resources/          static + templated resources
├── prompts/            7 built-in prompt templates
├── viz/                table · csv · chartjs · vega · mermaid · svg · geojson
└── http/               streamable HTTP endpoint + demo dashboard
```

## The data flow of one tool call

`compare_countries({countries: ["Egypt", "Jordan"]})`:

1. **Tool layer** (`tools/countries.ts`) validates input via zod, resolves each
   query string through `resolveCountry()` → provider `search()` → ISO3.
2. It asks the **registry** for a provider serving the `population` dataset and
   calls `list({dataset, asylum_iso3: "EGY", yearFrom, yearTo})`.
3. The **UNHCR provider** translates ISO3 → UNHCR-internal code
   (`EGY` → `coa=ARE`) via its cached country index, builds the URL, and hands
   it to the shared **HttpClient**.
4. HttpClient consults the **cache** (fresh → return; stale → serve + refresh
   in background; miss → rate-limited fetch with retry/backoff and ETag).
5. Raw rows return through `normalize.ts`, which converts UNHCR's mixed
   number/string/`"-"` cells into clean `NormalizedRecord`s keyed by ISO3.
6. The tool aggregates per year, renders a markdown table for humans and a
   `structuredContent` object for machines, and returns both.

Any error along the way surfaces as an `isError` tool result with a message
the model can act on ("No country matched…", "Offline mode is enabled and this
data is not cached yet…") — never a stack trace.

## The normalized record

Every provider must emit this shape (see `src/providers/types.ts`):

```ts
{
  country: "Egypt",          // display name of the record's subject
  country_code: "EGY",       // ISO3, always — never provider-internal codes
  origin / origin_code,      // when the dataset has an origin side
  asylum / asylum_code,      //   "        "        an asylum side
  year: 2023,
  population: 472761,        // headline "people of concern" figure
  metrics: { refugees: 240507, asylum_seekers: 232244, ... },
  source: "unhcr",
  last_updated: "2026-…",    // when we fetched/normalized it
  dataset: "population"
}
```

`population` semantics per dataset:

| dataset              | headline                                                 |
| -------------------- | -------------------------------------------------------- |
| population           | refugees + asylum_seekers + idps + stateless + ooc + oip |
| demographics         | `total`                                                  |
| asylum-applications  | `applied`                                                |
| asylum-decisions     | `dec_total`                                              |
| context-indicators   | `national_population` (World Bank)                       |
| idps                 | IDP stock, latest assessment of the year (IOM DTM)       |
| conflict-events      | events in the year (ACLED)                               |
| humanitarian-funding | funding received, US$ (OCHA FTS)                         |
| food-security        | people in IPC phase 3+ ("crisis or worse")               |

Aggregation semantics that are easy to get wrong are encoded per provider:
IDP assessment rounds are never summed (latest wins), funding coverage is
recomputed from summed appeals (never averaged), IPC current analyses beat
projections, and conflict district×month rows sum into country-years.

## Caching strategy

Three time horizons, per URL:

- **age < TTL** (default 1 h): served from cache, zero network.
- **TTL ≤ age < stale ceiling** (default 7 d): served stale immediately,
  refreshed in the background (stale-while-revalidate). One in-flight refresh
  per URL, deduplicated.
- **age ≥ stale ceiling**: fetched in the foreground with `If-None-Match` when
  an ETag is stored; a `304` costs no bandwidth and resets the clock.

Network failure at any point falls back to whatever is cached, with a warning.
`HMCP_OFFLINE=1` short-circuits everything to cache-only and fails loudly on a
miss. The country reference list uses a 7-day TTL since it changes ~never.

Backends implement a four-method `Cache` interface; the SQLite backend uses
Node's built-in `node:sqlite` (no native npm deps) and degrades to memory on
older Node versions.

## Politeness & safety

- Token-bucket rate limiter per provider (default 4 req/s) sits **before**
  every network call, including retries.
- Retries: 3 attempts on 408/425/429/5xx and network errors, exponential
  backoff with jitter.
- Identified `User-Agent` on every request.
- The entire server is read-only; every tool carries `readOnlyHint: true`.

## Transports

- **stdio** (default): logs strictly to stderr, stdout is pure JSON-RPC.
- **Streamable HTTP** (`--http`): stateless mode — each POST to `/mcp` gets a
  fresh server+transport pair, so the endpoint scales horizontally with no
  session store. The same process serves the demo dashboard, which talks to an
  in-process MCP client over `InMemoryTransport` — the dashboard displays
  exactly what a real client negotiates, not a parallel implementation.
  Everything except `GET /health` (the no-upstream liveness probe) is rate
  limited per client IP (`HMCP_HTTP_RATE_LIMIT_RPM`, default 120, 0 = off) so
  one caller cannot exhaust the upstream quotas all providers share, and
  `/api/status` is memoized for 15 s so dashboard refreshes never fan out to
  provider health probes.

## Design invariants

1. **Provider isolation.** Grep for `ARE` or `coa=` outside `src/providers/unhcr/` — you'll find nothing. If a second provider needs something UNHCR-shaped, it graduates into `shared/`.
2. **Tools are provider-agnostic.** They reach data only through `ProviderRegistry.forDataset()`.
3. **Structured + human output.** Every tool returns machine-readable `structuredContent` (validated against its declared `outputSchema`) plus markdown `content`.
4. **Pure normalization.** `normalize.ts` files are pure functions with fixture-based unit tests.
5. **Honest limits.** Truncation, missing centroids, and forecast naivety are stated in the output, not hidden.
