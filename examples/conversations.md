# Example conversations

Real interactions this server enables once connected to an MCP client.
Tool traces show what happens under the hood.

---

## "Which countries carry the heaviest refugee-hosting burden — per capita, not absolute?"

**Tool trace**

```
top_host_countries({ normalize_by: "population", limit: 6 })
```

**Assistant (excerpt — production data, 2024)**

> Per 1,000 residents the picture inverts — small and low-income countries
> lead, not large economies:
>
> | #   | Country         | per 1,000 residents | raw       |
> | --- | --------------- | ------------------- | --------- |
> | 1   | Lebanon         | 130.7               | 758,642   |
> | 2   | Chad            | 63.0                | 1,278,866 |
> | 3   | Rep. of Moldova | 56.6                | 135,941   |
> | 4   | Jordan          | 55.7                | 643,641   |
>
> _Denominators: World Bank population, matched per year (2024); the
> denominator year is disclosed on every row._

---

## "Relate Sudan's conflict to its displacement since 2022." _(needs the `hdx` provider)_

**Tool trace**

```
conflict_events({ country: "Sudan", year_from: 2022, year_to: 2024 })
export_data({ dataset: "idps", country: "Sudan", year_from: 2022, year_to: 2024, format: "json" })
```

**Assistant (excerpt — production data)**

> The April 2023 war is unmistakable in both series. Conflict fatalities
> (ACLED): 2,770 (2022) → 21,020 (2023) → 22,987 (2024). Internally
> displaced people (IOM DTM, latest assessment per year): 3.78M → 9.05M →
> 11.56M. Humanitarian funding covered 58.5% of appeal requirements in 2023
> and 76.4% in 2024 (OCHA FTS)…

---

## «قارن بين عدد اللاجئين في مصر والأردن» — Arabic works too

**Tool trace**

```
compare_countries({ countries: ["مصر", "الأردن"], year_from: 2020 })
```

Country resolution is bilingual: «مصر», «الأردن», «السودان» resolve exactly
like "Egypt", "Jordan", "Sudan" — including spelling variants («الاردن»,
«اردن»).

---

## "Compare refugee populations in Egypt and Jordan over the last five years."

**Tool trace**

```
compare_countries({ countries: ["Egypt", "Jordan"], year_from: 2020, year_to: 2024 })
```

**Assistant (excerpt)**

> Between 2020 and 2024 the two countries diverged sharply. Jordan's refugee
> population stayed nearly flat (≈670k → 684k), dominated by Syrians under
> long-term hosting arrangements. Egypt's more than doubled after April 2023
> (≈273k → 2023: 240k registered refugees plus a surge of asylum-seekers),
> driven by arrivals from Sudan…
>
> | Year | Egypt   | Jordan  |
> | ---- | ------- | ------- |
> | 2020 | 273,097 | 669,391 |
> | …    | …       | …       |
>
> _Source: UNHCR Refugee Data Finder (end-year stocks)._

---

## "Generate a humanitarian report about Sudan."

**Tool trace**

```
generate_country_report({ country: "Sudan" })
→ progress: Fetching displacement history … Composing report (5 steps)
```

Returns a complete markdown report — key figures, 10-year refugee trend with
an embedded Mermaid chart, origins of hosted refugees, asylum decisions,
demographics, and method notes — ready to paste into a document. Follow-ups
like _"condense this into a one-page donor briefing"_ work on the structured
output without further tool calls.

---

## "Show demographics of refugees hosted in Egypt."

**Tool trace**

```
demographics({ country: "Egypt" })
```

> As of 2025, UNHCR counts **1,098,306** people of concern in Egypt — 54.2%
> female, 39.1% children (0–17):
>
> | Age group | Female | Male   | Share |
> | --------- | ------ | ------ | ----- |
> | 0–4       | 45,823 | 47,293 | 8.5%  |
> | 5–11      | 87,350 | 90,630 | 16.2% |
> | …         |        |        |       |

---

## "Create a chart of Syrian refugee trends."

**Tool trace**

```
trend_analysis({ country: "Syria", role: "origin" })
generate_chart({ countries: ["Syria"], role: "origin", format: "mermaid" })
```

The `role: "origin"` distinction matters — the model learns it from the tool
descriptions and server instructions: Syrians displaced _from_ Syria, not
refugees hosted _in_ Syria.

```mermaid
xychart-beta
    title "refugees (origin side), 2018–2024 — UNHCR"
    x-axis "Year" [2018, 2019, 2020, 2021, 2022, 2023, 2024]
    y-axis "refugees"
    line [6654374, 6615249, 6702910, 6848865, 6559736, 6355788, 5952174]
```

Ask for `format: "chartjs"` or `"vega-lite"` for renderable specs, or
`"svg"` for a finished image.

---

## "Which countries host the most refugees right now? Map them."

**Tool trace**

```
top_host_countries({ limit: 10 })
generate_map({ limit: 25 })
```

> The top hosts in 2025: Germany (2.66M), Türkiye (2.39M), Uganda (1.94M),
> Chad (1.50M), Bangladesh (1.18M)… (GeoJSON attached — drop it into
> geojson.io or any Leaflet map.)

---

## "Was there anything unusual in Sudan's displacement data?"

**Tool trace**

```
trend_analysis({ country: "Sudan", role: "origin", year_from: 2010, year_to: 2024 })
```

> Yes — 2023 is a statistical outlier (z ≈ +2.6): people displaced from Sudan
> jumped 78.8% year-over-year, from 837k to 1.50M, coinciding with the
> outbreak of the conflict in April 2023. The regression over 2015–2024 shows
> displacement rising ≈122k/year (R²=0.61), but that average hides the
> post-2023 regime shift…

---

## "Give me the raw numbers as CSV."

**Tool trace**

```
export_data({ dataset: "population", format: "csv", country: "Jordan",
              year_from: 2015, year_to: 2024 })
```

Returns RFC-4180 CSV with normalized headers (`country, country_code, year,
population, refugees, asylum_seekers, …`) — consistent across every provider
this server will ever have.

---

## Using the built-in prompts

In Claude Desktop, pick **donor_briefing** from the prompt menu, type
`Sudan` — the server expands it into instructions that sequence
`generate_country_report` + `demographics`, sets the tone, and requires
citations. No prompt engineering by the user.
