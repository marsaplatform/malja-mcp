# Launch kit — humanitarian-mcp

Platform-native drafts, ready to paste after the repo goes live. One core
angle, adapted per platform — do not cross-post the same copy.

## Core angle

> Humanitarian data is public but booby-trapped for machines: UNHCR's API uses
> its own country codes that contradict ISO for **99 of 232 countries**
> (Egypt is `ARE` — which is the UAE's ISO code). Every AI assistant hitting
> the raw API rediscovers these traps and silently gets wrong answers.
> humanitarian-mcp fixes them **once**, behind the Model Context Protocol,
> for every assistant at the same time.

Supporting specifics (use these, not adjectives): 99/232 code mismatches ·
3 live sources (UNHCR + World Bank + HDX) · 75 years of data · 20 tools ·
125 tests · read-only · no API key · Arabic country names · per-capita
rankings (Lebanon: 130.7 refugees per 1,000 residents) · anomaly detection
caught Sudan's 2023 spike (+78.8% YoY) automatically.

---

## 1 · X thread (7 posts)

**1/** UNHCR's API says Egypt's country code is "ARE".
"ARE" is the UAE's ISO code.
99 of 232 countries have mismatches like this.

This is why your AI assistant quietly fails at refugee data — the API returns
empty results instead of errors when you guess wrong.

So I fixed it once, for every assistant.

**2/** humanitarian-mcp: an open-source MCP server for humanitarian open data.

Your assistant asks: "compare refugee populations in Egypt and Jordan"
It gets: clean tables, ISO3 codes, year-stamped figures, UNHCR citation.
No REST, no pagination, no country-code trivia.

**3/** 20 tools, all read-only:
country profiles · comparisons · demographics · asylum stats · conflict
events · food security · humanitarian funding · rankings · trend analysis ·
forecasts · full markdown reports · CSV/GeoJSON export

Ask for top hosts _per capita_ and the list flips: Lebanon (130.7 per 1,000
residents), Chad, Moldova — not the big economies. The trend tool flagged
Sudan's 2023 displacement spike (+78.8% YoY, z=2.6) without being asked.

**4/** It draws, too.

Ask for a chart → get Chart.js config, Vega-Lite spec, Mermaid block, or a
finished SVG. Ask for a map → GeoJSON you can drop straight into geojson.io.

**5/** The boring parts are the point:
– SQLite cache w/ ETag revalidation + stale-while-revalidate
– full offline mode
– token-bucket rate limiting (be polite to UNHCR)
– 125 tests incl. an MCP compliance suite driven by the official SDK client

**6/** GitHub MCP wraps GitHub. Slack MCP wraps Slack.
This aims to be that, for humanitarian data.

Three sources are live today: UNHCR (displacement), World Bank (the
denominators behind per-capita views) and HDX (conflict via ACLED, food
security via IPC, funding via OCHA FTS). ReliefWeb is next — a provider is
one directory implementing one interface, and there's a step-by-step guide.

**7/** MIT licensed. Try it in 10 seconds — a hosted endpoint is live, or run
it locally with Claude Desktop, Claude Code, Cursor — anything that speaks MCP.

humanitarian-mcp.zad.tools

If you work in humanitarian data or build MCP servers, I'd genuinely value
your eyes on it.

---

## 2 · LinkedIn post

**"AI for good" usually fails at the plumbing. So we built the plumbing.**

Public humanitarian data is a minefield for AI systems. One example: UNHCR's
API identifies Egypt as "ARE" — which is the United Arab Emirates' code in
the ISO standard the rest of the world uses. 99 of 232 countries have
mismatches like this, and wrong guesses return empty data instead of errors.

An AI assistant built on that either hallucinates or goes silent. Neither is
acceptable when the numbers describe displaced people.

humanitarian-mcp is my answer: an open-source Model Context Protocol server
that gives any AI assistant (Claude, Cursor, custom agents) clean, cited
access to three live sources — UNHCR's 75 years of refugee statistics, World
Bank context indicators, and HDX crisis data (conflict, food security,
humanitarian funding).

What it does:
→ Answers "compare Egypt and Jordan's refugee populations" with sourced tables — in English or Arabic
→ Ranks hosting burden per capita (Lebanon: 130.7 refugees per 1,000 residents), not just absolute counts
→ Detects statistical anomalies — it flagged Sudan's 2023 crisis spike on its own
→ Generates donor briefings, charts and GeoJSON maps on request
→ Strictly read-only, rate-limited, works fully offline once cached

The architecture treats providers as plugins — ReliefWeb is next, so one
integration effort serves every AI tool at once.

MIT licensed, 125 tests, production-grade. If your organization works with
displacement data and is exploring AI assistants, the repo is linked in the
comments — and contributions are welcome.

_(first comment: repo link + quick-start)_

---

## 3 · Show HN

**Title:** Show HN: Humanitarian MCP – UNHCR refugee data as an MCP server

**Body:**

I built an open-source Model Context Protocol server that exposes trusted
humanitarian open data — the UNHCR Refugee Statistics API (75 years of
displacement data, no key required), World Bank indicators, and HDX crisis
data (ACLED conflict events, IPC food security, OCHA FTS funding) — as
semantic tools for AI assistants.

Why it exists: the raw API is hostile to LLMs in ways that produce silent
wrong answers. UNHCR uses its own 3-letter country codes that disagree with
ISO3 for 99 of 232 countries — Egypt is "ARE", which is the UAE's ISO code.
Numeric cells arrive as numbers, numeric strings, or "-". Per-country
breakdowns need an undocumented-feeling coa_all=true. Mistakes return empty
arrays, not errors. An LLM burns tokens rediscovering this every session; a
server encodes it once.

What's in it: 20 read-only tools (profiles, comparisons — absolute or
per-capita via World Bank denominators matched per year — demographics,
asylum stats, conflict events, food security, humanitarian funding, trend
analysis with z-score anomaly detection, chart generation as
Chart.js/Vega-Lite/Mermaid/SVG, GeoJSON maps, CSV export with reproducible
extraction manifests and codebooks), resources like country://EGY, and 7
prompt templates. Country names resolve in English and Arabic. Structured
outputs throughout, stdio + stateless streamable HTTP, SQLite cache with
ETag revalidation and a real offline mode. 125 tests including an MCP
compliance suite driven through the official SDK client. TypeScript, MIT,
two runtime dependencies (SDK + zod).

The provider layer is pluggable (one directory, one interface) — UNHCR,
World Bank and HDX/HAPI are live; ReliefWeb is scaffolded next. I'd
particularly welcome scrutiny of the normalization semantics from anyone who
works with this data professionally, and feedback on the MCP surface design
from folks building servers.

Repo: https://github.com/ahmedvnabil/humanitarian-mcp
Hosted endpoint + landing page (Arabic): https://humanitarian-mcp.zad.tools

---

## 4 · GitHub repo metadata

**Description (About):**

> Model Context Protocol server for humanitarian open data — UNHCR, World Bank and HDX (conflict, food security, funding) as semantic tools for AI assistants. Read-only, cached, offline-capable, Arabic-aware.

**Topics:**
`mcp` `model-context-protocol` `unhcr` `refugees` `humanitarian` `open-data`
`claude` `ai-tools` `typescript` `data-for-good`

**Social preview:** upload `assets/social-preview.png` (1280×640, already in repo)
via Settings → General → Social preview.

---

## 5 · Posting order & CTAs

| Step | Where                                       | When                                                         | CTA                                     |
| ---- | ------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| 1    | Push repo + set About/topics/social preview | day 0                                                        | —                                       |
| 2    | Show HN                                     | day 0, weekday morning US time                               | feedback on normalization + MCP surface |
| 3    | X thread                                    | same day, after HN gets first comments                       | "eyes on it" / star                     |
| 4    | LinkedIn                                    | day 1–2                                                      | orgs exploring AI + displacement data   |
| 5    | r/LocalLLaMA or MCP community Discord       | day 2–3, reworked as "what I learned building an MCP server" | technical discussion                    |

CTA variants: ⭐ star (X) · contribute a provider (HN/Reddit) · pilot it in
your org (LinkedIn) · "add ReliefWeb with me" (community posts).

## Missing inputs before publishing

- [ ] Repo actually pushed (badges 404 until then)
- [ ] npm name `humanitarian-mcp` availability if publishing the package
- [ ] Optional but high-impact: 30-second GIF of the dashboard "Try a query" panel
- [ ] Your preferred author handle/name in package.json (`author` field is empty)
