# humanitarian-mcp for researchers

Reproducible workflows from research question to citable dataset. Everything
below uses real UNHCR figures served by this MCP — ask the questions in plain
language (Arabic or English) inside any connected assistant.

Prefer code to chat? The same workflows run end-to-end in
[Python and R notebooks](../examples/notebooks/) against a local server.
Add `include_codebook: true` to any `export_data` call for a variable-level
codebook ready for your data appendix.

## Why this beats hand-collecting from the Refugee Data Finder

- **Clean identifiers**: every row carries ISO3 codes — joins against World
  Bank / V-Dem / UCDP panels work without a country-name crosswalk.
- **Consistent schema**: `country, country_code, year, population, metrics…`
  across every dataset (and every future provider).
- **Provenance**: each payload carries the source and reference year; the
  numbers remain verifiable against the
  [UNHCR Refugee Data Finder](https://www.unhcr.org/refugee-statistics/).
- **Reproducibility**: a tool call with pinned arguments is a repeatable
  extraction recipe you can put in an appendix.

## Workflow 1 — Event study (interrupted time series)

_Question: what did the April 2023 war do to displacement from Sudan?_

```text
trend_analysis({ country: "Sudan", role: "origin", year_from: 2010 })
→ anomalies: [{ year: 2023, changePct: +78.8, zScore: 2.6 }]

export_data({ dataset: "population", country: "Sudan", role: "origin",
              format: "csv", year_from: 2010 })
```

Python:

```python
import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("sudan.csv")            # country_code, year, refugees, idps…
df["post"] = (df.year >= 2023).astype(int)
df["t"] = df.year - df.year.min()
model = smf.ols("refugees ~ t + post + t:post", data=df).fit()
print(model.summary())
```

R:

```r
df <- read.csv("sudan.csv")
df$post <- as.integer(df$year >= 2023)
df$t <- df$year - min(df$year)
summary(lm(refugees ~ t * post, data = df))
```

## Workflow 2 — Asylum policy comparison

_Question: how do recognition rates differ across host states?_

```text
asylum_decisions({ country: "Egypt", year_from: 2019 })
→ per-year recognized / complementary / rejected / closed
  + recognition_rate_pct  (recognized + complementary) / substantive decisions
```

The recognition rate — the standard dependent variable in asylum-policy
literature — is computed for you, per year, with the formula stated in the
output. Repeat per country or pull raw rows for all countries in one call:

```text
export_data({ dataset: "asylum-decisions", group_by: "asylum",
              year_from: 2023, year_to: 2023, format: "csv" })
```

## Workflow 3 — Demographic composition

_Question: what share of refugees in Egypt are women and children?_

```text
demographics({ country: "Egypt" })
→ 2025: total 1,098,306 · 54.2% female · 39.1% children (0–17)
```

Age/sex buckets (`0–4, 5–11, 12–17, 18–59, 60+` × female/male) come
normalized; `generate_chart(format: "svg")` produces a publication-ready
figure. Note: UNHCR publishes demographics for recent years only.

## Workflow 4 — Hosting burden, per capita

_Question: which countries carry the largest hosting burden relative to their
size?_ Absolute numbers hide it: Lebanon and Germany host similar refugee
counts; per 1,000 residents they are worlds apart.

```text
top_host_countries({ year: 2024, normalize_by: "population" })
→ ranked refugees per 1,000 residents, with each country's raw value and
  the World Bank denominator year disclosed per row

compare_countries({ countries: ["Lebanon", "Jordan", "Germany"],
                    normalize_by: "population", year_from: 2015 })
→ per-capita series, denominators matched per year (2015 refugees ÷ 2015
  population — not today's population)
```

`normalize_by: "gdp"` gives the same views per US$1bn of GDP. Denominators
come from the World Bank provider (`context-indicators` dataset, enabled by
default); countries with no denominator data are omitted **and counted** in
the output, never silently dropped.

## Method notes & caveats

- Figures are **end-year stocks** (recent years may be mid-year preliminary);
  UNHCR revises series retroactively — record your extraction date.
- `population` = refugees + asylum-seekers + IDPs + stateless + others of
  concern + other people in need of international protection (documented in
  [architecture.md](architecture.md)).
- `forecast` is a naive OLS extrapolation and says so — never present it as a
  UNHCR planning figure.
- role="asylum" = hosted **in** the country; role="origin" = displaced
  **from** it. Mixing these up is the most common analysis error.

## Citing

Cite the data as UNHCR, Refugee Data Finder (year of extraction), and the
tooling via GitHub's **"Cite this repository"** button (backed by
[CITATION.cff](../CITATION.cff)), or as:

> humanitarian-mcp (v0.5.0), open-source MCP server,
> https://github.com/ahmedvnabil/humanitarian-mcp

Every `export_data` call attaches an extraction manifest (exact arguments,
timestamp, server version, citation) — paste it in your appendix and anyone
can reproduce the pull. In CSV it rides in `#` comment lines:
`pd.read_csv("sudan.csv", comment="#")` / `read.csv("sudan.csv", comment.char="#")`.

## Offline fieldwork

`HMCP_CACHE=sqlite` + one warm-up session, then `HMCP_OFFLINE=1` gives you the
full toolset with zero connectivity — useful where fieldwork happens.
