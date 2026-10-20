# Tool reference

Conventions shared by every tool:

- `country` accepts a name, alias or ISO3 code — in English or Arabic
  (`"Egypt"`, `"egypt"`, `"EGY"`, `"DRC"`, `"مصر"`, `"الأردن"`). Unresolvable
  queries return an `isError` result suggesting `search_country`.
- `role`: `"asylum"` (default) = people hosted **in** the country;
  `"origin"` = people displaced **from** it.
- `normalize_by` (`compare_countries`, `top_host_countries`, `generate_chart`,
  `durable_solutions`):
  `"population"` → values per 1,000 residents · `"gdp"` → per US$1bn GDP ·
  `"none"` (default). Denominators come from the `context-indicators` dataset
  (World Bank provider, enabled by default), are matched per year, and the
  observation year actually used is always disclosed.
- `year_from` / `year_to` default to the last 10 years.
- `locale` (every tool, optional): `"en"` (default) or `"ar"` — the language
  of the human-readable `content`. See [Language / Arabic output](#language--arabic-output).
- Every tool returns markdown `content` plus `structuredContent` matching its
  declared `outputSchema`, and is annotated `readOnlyHint: true`.
- Source figures are end-year stocks from the UNHCR Refugee Data Finder;
  context indicators come from the World Bank (CC BY 4.0); crisis datasets
  (conflict, food security, funding, IDPs) come via HDX HAPI and cite their
  original producers (ACLED, IPC, OCHA FTS, IOM DTM); situation reports come
  from ReliefWeb (UN OCHA) and remain © their publishing organisations.

## Language / Arabic output

Every tool accepts an optional `locale` (`"en"` | `"ar"`); the server-wide
default comes from `MALJA_LOCALE` (default `en`). With `locale: "ar"` the
markdown `content` is written in Modern Standard Arabic:

- headings, table headers, notes, caveats, the forecast disclaimer, error
  messages and progress notifications;
- metric labels with UNHCR's Arabic terminology (اللاجئون، طالبو اللجوء،
  النازحون داخلياً، عديمو الجنسية، العائدون، الحماية التكميلية) and IPC phase
  names from the Arabic IPC manual (الحد الأدنى، الضغط، الأزمة، الطوارئ،
  الكارثة/المجاعة);
- country names in their official UN Arabic short form (falling back to the
  provider's name when unknown), region names and dataset titles;
- the full `generate_country_report` / `report://` markdown, chart titles,
  axis labels, legends and tick labels (Chart.js, Vega-Lite, Mermaid, SVG);
- `export_data` codebooks (descriptions and units);
- citations: the producer's original citation is kept verbatim and prefixed
  with an Arabic producer label, e.g. `المصدر: المفوضية السامية للأمم المتحدة
لشؤون اللاجئين (UNHCR) — UNHCR Refugee Data Finder`.

What deliberately stays the same in every locale, so machine consumers never
break: `structuredContent` field names and values (country names stay as the
provider publishes them), ISO3 codes, dataset ids, metric keys, export column
names, CSV/JSON payloads and the extraction manifest. Free-text structured
fields meant for humans (`forecast.caveat`, chart `title`/`spec` labels,
report `markdown`, codebook `description`/`unit`) follow the locale.

**Digits.** Arabic output uses Western digits (0–9) with `,` thousands
separators by default — the form used by most Arabic news media and UN Arabic
statistics online, and the one that copies cleanly into spreadsheets. Set
`MALJA_DIGITS=arab` for Arabic-Indic digits (٠–٩, `٬` `٫` `٪`). Years, ranges
and percentages follow the same setting; indicator codes (`SP.POP.TOTL`),
ISO3 codes and URLs are never reshaped.

**Right-to-left.** Signed numbers carry a left-to-right mark so `+10,000`
never renders as `10,000+`; year ranges are written in words (`من 2015 إلى
2024`) instead of a dash that bidi rendering would flip. SVG charts set
`direction="rtl"`, use an Arabic-capable font stack and lay the legend out
right-to-left (the time axis keeps running left→right, as in Arabic
statistical publications); Chart.js specs set `locale: "ar"` and RTL
legend/tooltips. Built-in prompts accept `locale: "ar"` and instruct the
model to answer in Arabic and call tools with `locale="ar"`.

Example — `refugee_population` with `{ "country": "مصر", "year_from": 2023, "year_to": 2023, "locale": "ar" }` (recorded UNHCR data):

```text
أرقام النزوح — **مصر** (بحسب بلد اللجوء)، 2023

| السنة | اللاجئون | طالبو اللجوء | النازحون داخلياً | عديمو الجنسية | إجمالي المشمولين بالاهتمام |
| --- | --- | --- | --- | --- | --- |
| 2023 | 240,507 | 232,244 | 0 | 10 | 472,761 |

_المصدر: المفوضية السامية للأمم المتحدة لشؤون اللاجئين (UNHCR) — UNHCR Refugee Data Finder, https://www.unhcr.org/refugee-statistics/_
```

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

### durable_solutions

`country` · `role` (default **`"origin"`**) · `other_country` · `year_from` · `year_to` · `normalize_by`
→ `{ measure: "flow", years: [{ year, metrics: { returned_refugees?, resettlement?, naturalisation?, returned_idps? }, total, total_normalized?, denominator_year? }], period_totals, period_total, normalize_by, unit }`

UNHCR durable solutions from the keyless `api.unhcr.org/population/v1/solutions/`
endpoint. **Aggregation semantics:** unlike `refugee_population` (end-year
stocks), these are **flows recorded during each year**, so the tool reports a
period total and a solution mix — summing years is meaningful here and only
here. A metric UNHCR did not report (`"-"` upstream) is **absent** from
`metrics` and shown as `—`; it is never turned into `0`.

| role               | `returned_refugees`                      | `resettlement`                         | `naturalisation`               | `returned_idps`       |
| ------------------ | ---------------------------------------- | -------------------------------------- | ------------------------------ | --------------------- |
| `origin` (default) | refugees who returned **to** the country | nationals resettled to third countries | nationals naturalised abroad   | IDP returns inside it |
| `asylum`           | refugees who left it to return **home**  | people resettled **to** it             | refugees naturalised **in** it | IDP returns inside it |

`other_country` cross-filters the opposite side (`country="Syria"`,
`other_country="Lebanon"` → Syrians returning from Lebanon). `normalize_by:
"population"` adds the yearly total per 1,000 residents of `country`
(`"gdp"`: per US$1bn GDP), with the denominator year disclosed. Also exported
via `export_data({ dataset: "solutions" })` (codebook included) and the
`solutions://{code}` resource (10-year origin-side flows, JSON).

```text
durable_solutions({ country: "سوريا", year_from: 2021, year_to: 2025, locale: "ar" })

الحلول الدائمة — **سوريا** (بحسب بلد المنشأ)، من 2021 إلى 2025
| السنة | عودة اللاجئين | إعادة التوطين | التجنّس | عودة النازحين داخلياً | إجمالي الحلول |
| 2024 | 512,718 | 25,532 | 17,595 | 513,896 | 1,069,741 |
| 2025 | 1,341,148 | 8,714 | 14,676 | 1,964,201 | 3,328,739 |
| **إجمالي الفترة** | 1,979,203 | 109,927 | 86,274 | 2,962,766 | 5,138,170 |
**توزيع الحلول خلال الفترة:** عودة اللاجئين 38.5% · إعادة التوطين 2.1% · التجنّس 1.7% · عودة النازحين داخلياً 57.7%
```

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

### situation_reports

`country` · `year_from` · `year_to` · `query?` · `max_reports?` (1–20, default 5) — requires the `reliefweb` provider
→ `{ country, country_code, records: [{ year, reports }], latest: [{ title, url, source, date }], source }`
Yearly counts of published situation reports plus the most recent titles and
links. `query` filters the listed reports only (e.g. `"cholera"`) — the yearly
counts stay unfiltered. Use it to ground trends and anomalies from other tools
in what was actually reported. Source: ReliefWeb (UN OCHA).

### trend_analysis

`country` · `metric` · `role` · `year_from` · `year_to`
→ `{ series, year_over_year, trend: { slope_per_year, r2, direction, cagr_pct }, anomalies: [{year, change, zScore}], changepoints: [{ year, level_shift, slope_before, slope_after }], segments: [{ from, to, slope_per_year }] }`
Anomalies are years whose YoY change deviates ≥2σ from the series mean.

**Changepoints** are structural breaks — a jump in level and/or a change of
slope that persists. Method (pure TypeScript, no dependencies):

- exact penalised segmentation by **Optimal Partitioning** (the exact dynamic
  programme PELT accelerates; yearly series are short, so it is exact and instant);
- piecewise-**linear** cost (residual sum of squares of a least-squares line
  per segment), so a steady trend is _not_ split into a staircase;
- BIC/SIC-type penalty `3·σ²·ln n` per extra segment, with σ estimated
  robustly from second differences (MAD) and floored at 2% of the series'
  median level — a perfectly smooth series yields no breaks;
- ≥3 years per segment: a break in the last two years is dated to the start
  of the final 3-year window at the latest. Use the anomaly z-scores for the
  most recent years, and a wide window (`year_from`) for power.

`level_shift` is the jump at the break year versus the previous segment's
line extrapolated into that year. Recorded UNHCR data: Sudan IDPs (origin,
2010–2025) → 2023, +6,196,505; Syria refugees (origin) → 2012; Egypt hosted
refugees → 2013 (Syrian arrivals) and 2023. Breaks are candidates to explain
(e.g. with `situation_reports`), not proof.

```text
trend_analysis({ country: "السودان", role: "origin", metric: "idps", year_from: 2010, year_to: 2025, locale: "ar" })

**سنوات شاذة إحصائياً:** 2023 (‎+5,500,105، z=3.0)
**نقاط التحوّل (الانقطاعات الهيكلية):** 2017 (قفزة ‎-1,108,043 مقارنةً بالاتجاه السابق؛ الميل من ‎+132,690 إلى ‎+341,773 سنوياً)، 2023 (قفزة ‎+6,196,505 مقارنةً بالاتجاه السابق؛ الميل من ‎+341,773 إلى ‎+43,243 سنوياً)
```

### forecast

`country` · `metric` · `role` · `years_ahead` (1–5, default 3) · `since_break` (default false) · `chart` (`svg`|`chartjs`|`vega-lite`, optional)
→ `{ historical, projected: [{ year, value, lower_80, upper_80, lower_95, upper_95 }], fit_from, fit_to, changepoints, method, intervals, caveat, chart? }`
Ordinary least squares over the last 10 years, floored at 0. **Always relay the caveat.**

- **Prediction intervals** (80% and 95%): `ŷ ± t(1−α/2, n−2) · s · √(1 + 1/n + (x₀−x̄)²/Sxx)`
  with exact Student-t quantiles (pure TS). They assume the straight-line
  model with independent residuals and cover ordinary year-to-year noise
  only — not shocks — so the output says real uncertainty is larger. With
  few points (e.g. 3 → 1 degree of freedom) they are honestly very wide.
- **Structural breaks** in the 10-year history are detected (see
  `trend_analysis`) and disclosed; `since_break: true` fits only the years
  since the latest break when ≥3 remain (`fit_from`/`fit_to` report the window).
- **`chart`**: observed line, dashed projection, 95% and 80% bands and
  changepoint markers (SVG and Vega-Lite natively; Chart.js bands via `fill`,
  markers via `chartjs-plugin-annotation`). RTL/Arabic like every chart.

```text
forecast({ country: "مصر", locale: "ar" })

| السنة | اللاجئون | النوع | الحد الأدنى 80% | الحد الأعلى 80% | الحد الأدنى 95% | الحد الأعلى 95% |
| 2025 | 220,033 | فعلي | — | — | — | — |
| 2026 | 246,280 | متوقَّع | 200,965 | 291,596 | 170,549 | 322,011 |
_رُصد انقطاع هيكلي في 2023، والخط مُلاءَم عبره. يمكن تمرير since_break: true._
```

### top_host_countries

`year?` (default latest) · `metric` · `by` (`asylum`|`origin`) · `normalize_by` · `limit` (≤50)
→ `{ year, metric, by, normalize_by, unit, ranking: [{ rank, country, country_code, value, raw_value?, denominator_year? }] }`
`by="origin"` turns it into top origin countries. With `normalize_by="population"`
the ranking is per 1,000 residents — the view where Lebanon, Jordan and Chad
lead instead of large economies; each row keeps the raw value and the
denominator year, and countries with no denominator data are counted, not
silently dropped.

### generate_chart

`countries` (1–5) · `metric` · `role` · `normalize_by` · `format` (`chartjs`|`vega-lite`|`mermaid`|`svg`) · `kind` (`line`|`bar`) · `show_changepoints` · `year_from` · `year_to`
→ `{ format, title, unit, spec }` — object for chartjs/vega-lite, string for mermaid/svg.
With `normalize_by`, the y-axis and title carry the unit (e.g. "refugees per 1,000 residents").
`show_changepoints: true` adds a dashed marker at each detected structural
break per series (SVG, Vega-Lite; Chart.js via `chartjs-plugin-annotation`;
ignored by Mermaid).

### generate_map

`year?` · `metric` · `by` · `limit` (≤200, default 25)
→ `{ year, metric, feature_count, skipped_countries, geojson }`
Country-centroid points; countries without a centroid are listed, not dropped silently.

### generate_country_report

`country` · `year_from` · `year_to`
→ `{ markdown }` — key figures, trend table + embedded mermaid chart, top origins,
asylum decisions, demographics, method notes. Emits 5 MCP progress notifications.

### export_report

`country?` · `markdown?` (≤400k chars; one of the two is required) · `title?` ·
`year_from` · `year_to` · `format` (`html`|`pdf`, default `html`) ·
`include_manifest` (default true) · `inline` (default false)
→ `{ format, requested_format, title, filename, mime_type, bytes, sha256, uri, locale, pdf_engine?, fallback_reason?, manifest? }`

Formats a country report — or any Markdown a tool returned (`trend_analysis`,
`compare_countries`, …) — as a **self-contained, print-ready document**:

- **HTML**: one file, no external requests. Inline CSS for A4 print
  (`@page`, page-break rules, repeated table headers), the Zad Arabic/Latin
  font (SIL OFL 1.1) embedded as WOFF2, `lang`/`dir` set from `locale` with
  logical CSS properties so Arabic is genuinely right-to-left, numeric
  columns aligned and bidi-isolated, English phrases inside Arabic lines
  isolated so citations read in order. Country reports embed the trend chart
  as a static SVG (no Mermaid runtime needed).
- **PDF**: the same HTML printed by a locally installed Chrome / Chromium /
  Edge in headless mode (auto-detected; override with `MALJA_CHROME_PATH`,
  disable with `MALJA_PDF=off`). If no browser is available, the tool returns
  the HTML instead with `fallback_reason` — open it and use the browser's
  _Print → Save as PDF_.
- **Provenance**: citations and the methodology note are kept verbatim; with
  `include_manifest` the document ends with an extraction-manifest table and
  carries the same manifest as JSON in
  `<script type="application/json" id="malja-manifest">`. In `markdown` mode the
  manifest records the SHA-256 of the supplied Markdown and labels the source
  as client-supplied.

The document is returned as an MCP `resource_link` to
`export://{id}/{filename}` (kept in server memory for 1 h, max 32 documents /
64 MB — nothing is written to disk), or embedded in the result with
`inline: true`. Client-supplied Markdown is HTML-escaped; raw HTML and SVG in it
are never rendered, and only `http(s)` links become anchors.

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
