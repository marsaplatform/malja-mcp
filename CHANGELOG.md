# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] — 2026-07-10

The narrative release: ReliefWeb situation reports join the platform, every
guidance surface catches up with the multi-provider reality, and the public
HTTP mode gets real abuse protection.

### Added

- **ReliefWeb provider** (`reliefweb`, opt-in): serves the new
  `situation-reports` dataset — one normalized record per published situation
  report, so year aggregation yields report counts — plus a `documents()`
  capability returning the actual report titles, publishers and links.
  Built on the ReliefWeb **v2** API (v1 is decommissioned); requires a
  pre-approved appname (`HMCP_RELIEFWEB_APPNAME`) per ReliefWeb's
  November 2025 policy, and `health()` explains a 403 accordingly.
- **`situation_reports` tool**: yearly report counts plus the latest report
  links for a country, with an optional free-text filter — the narrative
  companion to `trend_analysis`/`find_anomalies`.
- **`crisis_overview` prompt**: one-click integrated displacement + conflict
  - food security + funding + latest-reporting brief.
- Optional `documents()` method on the provider contract (like `countries()`).

- Hardened `--http` mode: per-client-IP inbound rate limiting on `/mcp` and
  `/api/*` (`HMCP_HTTP_RATE_LIMIT_RPM`, default 120/min, 0 disables; 429 +
  `Retry-After`, JSON-RPC-shaped for `/mcp`), a new lightweight `GET /health`
  liveness endpoint (no upstream calls, never rate limited), and `/api/status`
  memoized for 15 s so it cannot amplify into provider health probes.

### Changed

- Server instructions now describe the full multi-provider platform (UNHCR,
  World Bank, HDX, ReliefWeb) instead of "currently UNHCR refugee statistics",
  and tell clients to cite each payload's `source` rather than attributing
  everything to UNHCR.
- All prompts updated for the multi-source reality: per-source citations,
  per-capita comparisons via `normalize_by`, crisis tools where relevant, and
  anomaly explanations grounded in `conflict_events` + `situation_reports`.

## [0.5.1] — 2026-07-10

Fixes from the first live verification round against HAPI with a real app
identifier (all four themes now confirmed end-to-end with production data).

### Fixed

- **conflict-events returned nothing in production**: ACLED data exists in
  HAPI only at admin level 2 (district × month × event type) — the provider
  requested admin 0. Each theme now requests the admin level it actually
  publishes, and district rows sum into country-years as before.
- **Large themes were silently truncated**: theme fetches now pass the year
  window server-side (`start_date`/`end_date`) and paginate via `offset`
  until exhausted (capped at 100k rows with a logged warning, never silent).
- `funding` no longer receives an `admin_level` parameter its endpoint does
  not declare.

### Verified live

Sudan, production data: conflict 2023 = 6,967 events / 21,020 fatalities;
IDPs 3.78M → 9.05M → 11.56M (2022–2024, latest-assessment semantics);
IPC 3+ = 21.2M (2025); funding coverage 58.5% (2023) / 76.4% (2024);
per-capita ranking live: Lebanon 130.7, Chad 63.0, Moldova 56.6 per 1,000
residents. Arabic queries («السودان») resolve through the full stack.

## [0.5.0] — 2026-07-10

The academic reproducibility release.

### Added

- **Codebooks**: `export_data` accepts `include_codebook` — variable-level
  documentation (meaning, unit, derivation) matching exactly the exported
  columns, ready for a paper's data appendix.
- **Runnable notebooks** (`examples/notebooks/`): Python and R walk-throughs
  of four research workflows — event study, recognition rates, per-capita
  rankings, conflict × displacement — against a local server.
- **JOSS paper draft** (`paper/`): statement of need, comparison with
  per-source clients, quality control. Pending owner review and submission.

## [0.4.0] — 2026-07-10

### Added

- **HDX/HAPI provider** (`hdx`, opt-in via `HMCP_HDX_APP_ID`): internal
  displacement (IOM DTM), conflict events (ACLED), humanitarian funding
  (OCHA FTS) and food security (IPC), with per-theme aggregation semantics —
  stocks take the latest assessment (never summed), funding coverage is
  recomputed from summed appeals, IPC current analyses beat projections.
  Every payload cites the original producer.
- **Three crisis tools**: `conflict_events`, `food_security`,
  `humanitarian_funding` (20 tools total).
- **Docker image + compose** for organisational self-hosting (GHCR publish
  on release; HTTP mode, persistent SQLite cache volume, healthcheck).

## [0.3.0] — 2026-07-10

### Added

- **World Bank provider** (`worldbank`, enabled by default): national
  population, GDP, GDP per capita and poverty as the `context-indicators`
  dataset — no API key, CC BY 4.0.
- **`normalize_by`** on `compare_countries`, `top_host_countries` and
  `generate_chart`: values per 1,000 residents or per US$1bn GDP, with
  per-year denominator matching and the denominator year disclosed on every
  row. Rankings re-sort on the normalized value.

## [0.2.0] — 2026-07-10

### Added

- **npm + one-click distribution**: release workflow publishing to npm with
  provenance and attaching a Claude Desktop `.mcpb` bundle to every GitHub
  release; `npx humanitarian-mcp` quick start.
- **Arabic country names**: `search_country` and every country argument
  resolve official UN Arabic names for 100% of countries served, plus common
  variants — matching folds hamza/alef forms, taa marbuta, harakat and the
  definite article («الأردن» = «الاردن» = «اردن»).
- **Extraction manifests**: every `export_data` call attaches the exact
  arguments, timestamp, server version and citation (CSV: `#` comment lines;
  JSON/GeoJSON: a `manifest` member). Opt out with `include_manifest: false`.
- **Citation metadata**: `CITATION.cff` (GitHub "Cite this repository"),
  Zenodo-ready.

## [0.1.0] — 2026-07-09

First public release.

### Added

- **UNHCR provider** over the Refugee Statistics API: population, demographics,
  asylum applications and asylum decisions, 1951–present, no API key required.
  Full normalization of UNHCR quirks (internal country codes, `"-"` cells,
  mixed number/string values) behind ISO3-only records.
- **17 read-only tools**: `search_country`, `country_profile`,
  `compare_countries`, `refugee_population`, `demographics`,
  `latest_statistics`, `asylum_applications`, `asylum_decisions`,
  `trend_analysis` (with anomaly detection), `forecast`, `top_host_countries`,
  `generate_chart` (Chart.js / Vega-Lite / Mermaid / SVG), `generate_map`
  (GeoJSON), `generate_country_report` (with MCP progress notifications),
  `export_data` (CSV / JSON / Markdown / GeoJSON), `get_metadata`,
  `provider_health`. All with structured outputs.
- **Resources**: `metadata://providers|countries|datasets`, `dataset://{id}`,
  `country://{code}`, `report://{code}`, `chart://{code}` with URI-template
  completion.
- **7 prompts**: situation summary, two-country comparison, donor briefing,
  trend explainer, anomaly hunt, executive report, infographic content.
- **Transports**: stdio (default) and stateless Streamable HTTP (`--http`)
  with a self-contained demo dashboard.
- **Caching**: memory or SQLite (`node:sqlite`, zero native deps), TTL + ETag
  revalidation, stale-while-revalidate background refresh, offline mode.
- **Politeness**: per-provider token-bucket rate limiting, retry with
  exponential backoff, identified User-Agent.
- **Test suite**: 99 tests including an MCP compliance suite driven through
  the official SDK client and fixture-based provider tests (no network).

[0.1.0]: https://github.com/ahmedvnabil/humanitarian-mcp/releases/tag/v0.1.0
