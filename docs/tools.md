# Tool reference

Conventions shared by every tool:

- `country` accepts a name, alias or ISO3 code — in English or Arabic
  (`"Egypt"`, `"egypt"`, `"EGY"`, `"DRC"`, `"مصر"`, `"الأردن"`). Unresolvable
  queries return an `isError` result suggesting `search_country`.
- `role`: `"asylum"` (default) = people hosted **in** the country;
  `"origin"` = people displaced **from** it.
- `normalize_by` (`compare_countries`, `top_host_countries`, `generate_chart`):
  `"population"` → values per 1,000 residents · `"gdp"` → per US$1bn GDP ·
  `"none"` (default). Denominators come from the `context-indicators` dataset
  (World Bank provider, enabled by default), are matched per year, and the
  observation year actually used is always disclosed.
- `year_from` / `year_to` default to the last 10 years.
- Every tool returns markdown `content` plus `structuredContent` matching its
  declared `outputSchema`, and is annotated `readOnlyHint: true`.
- Source figures are end-year stocks from the UNHCR Refugee Data Finder;
  context indicators come from the World Bank (CC BY 4.0); crisis datasets
  (conflict, food security, funding, IDPs) come via HDX HAPI and cite their
  original producers (ACLED, IPC, OCHA FTS, IOM DTM).

---

### search_country

`query` (string, required) · `limit` (1–20, default 5)
→ `{ matches: [{ name, iso3, iso2?, region?, score }] }`

### country_profile

`country`
→ `{ country, country_code, year?, hosted{...}, displaced_abroad{...}, top_origins[...] }`
Latest hosted figures, figures for nationals abroad, top 5 origins of hosted refugees.

### compare_countries

`countries` (2–5) · `metric` (default `refugees`) · `role` · `normalize_by` · `year_from` · `year_to`
→ `{ metric, role, normalize_by, unit, series: [{ country, country_code, points: [{year, value}] }], denominator? }`

### refugee_population

`country` · `role` · `other_country` · `year_from` · `year_to` · `page` · `limit` (≤1000)
→ `{ records: NormalizedRecord[], page_info: { page, maxPages?, total? } }`
`other_country` cross-filters the opposite role: `country="Egypt", other_country="Syria"` = Syrians in Egypt.

### demographics

`country` · `role`
→ `{ year, female{0_4,5_11,12_17,18_59,60,total}, male{...}, total }`
Latest available year only (UNHCR publishes recent demographics only).

### latest_statistics

`country?` · `role`
→ `{ scope, year, figures{...} }` — omit `country` for global totals.

### asylum_applications

`country` · `role` · `year_from` · `year_to`
→ `{ yearly: [{ year, applied }] }`

### asylum_decisions

`country` · `role` · `year_from` · `year_to`
→ `{ yearly: [{ year, recognized, complementary, rejected, closed, total, recognition_rate_pct }] }`
Recognition rate = (recognized + complementary) / substantive decisions.

### conflict_events

`country` · `year_from` · `year_to` — requires the `hdx` provider
→ `{ country, country_code, records: [{ year, events, fatalities }] }`
Annual totals (monthly/event-type rows already summed). Source: ACLED via HDX.

### food_security

`country` · `year?` (default latest) — requires the `hdx` provider
→ `{ country, year, phases{ipc_phase_1..5, ipc_phase_3plus, analyzed_population}, people_crisis_or_worse }`
Latest current IPC analysis (projections excluded when a current one exists);
the headline is phase 3+ — people in crisis or worse. Source: IPC via HDX.

### humanitarian_funding

`country` · `year_from` · `year_to` — requires the `hdx` provider
→ `{ country, records: [{ year, requirements_usd, funding_usd, coverage_pct? }] }`
Appeals are summed per year and coverage recomputed from the sums (never
averaged). Source: OCHA FTS via HDX.

### trend_analysis

`country` · `metric` · `role` · `year_from` · `year_to`
→ `{ series, year_over_year, trend: { slope_per_year, r2, direction, cagr_pct }, anomalies: [{year, change, zScore}] }`
Anomalies are years whose YoY change deviates ≥2σ from the series mean.

### forecast

`country` · `metric` · `role` · `years_ahead` (1–5, default 3)
→ `{ historical, projected, method, caveat }`
Ordinary least squares over the last 10 years, floored at 0. **Always relay the caveat.**

### top_host_countries

`year?` (default latest) · `metric` · `by` (`asylum`|`origin`) · `normalize_by` · `limit` (≤50)
→ `{ year, metric, by, normalize_by, unit, ranking: [{ rank, country, country_code, value, raw_value?, denominator_year? }] }`
`by="origin"` turns it into top origin countries. With `normalize_by="population"`
the ranking is per 1,000 residents — the view where Lebanon, Jordan and Chad
lead instead of large economies; each row keeps the raw value and the
denominator year, and countries with no denominator data are counted, not
silently dropped.

### generate_chart

`countries` (1–5) · `metric` · `role` · `normalize_by` · `format` (`chartjs`|`vega-lite`|`mermaid`|`svg`) · `kind` (`line`|`bar`) · `year_from` · `year_to`
→ `{ format, title, unit, spec }` — object for chartjs/vega-lite, string for mermaid/svg.
With `normalize_by`, the y-axis and title carry the unit (e.g. "refugees per 1,000 residents").

### generate_map

`year?` · `metric` · `by` · `limit` (≤200, default 25)
→ `{ year, metric, feature_count, skipped_countries, geojson }`
Country-centroid points; countries without a centroid are listed, not dropped silently.

### generate_country_report

`country` · `year_from` · `year_to`
→ `{ markdown }` — key figures, trend table + embedded mermaid chart, top origins,
asylum decisions, demographics, method notes. Emits 5 MCP progress notifications.

### export_data

`dataset` (`population`|`demographics`|`asylum-applications`|`asylum-decisions`|`context-indicators`|`idps`|`conflict-events`|`humanitarian-funding`|`food-security`) ·
`format` (`csv`|`json`|`markdown`|`geojson`) · `country?` · `role` · `group_by` ·
`year_from` · `year_to` · `limit` (≤5000, default 500) · `include_manifest` (default true) · `include_codebook` (default false)
→ `{ dataset, format, row_count, truncated, data, manifest?, codebook? }`
`group_by` breaks rows down per asylum/origin country (needed for meaningful geojson).
The manifest records the exact arguments, extraction timestamp, server version
and citation — a repeatable extraction recipe for a paper's appendix. In CSV it
arrives as `#` comment lines (`pd.read_csv(..., comment="#")`,
`read.csv(..., comment.char="#")`); in JSON/GeoJSON as a `manifest` member.

### get_metadata

(no arguments)
→ `{ providers: [{ id, name, datasets: [{ id, metrics, citation }], attribution, terms }] }`

### provider_health

(no arguments)
→ `{ healthy, providers: [{ provider, ok, latencyMs?, detail, checkedAt }] }`
