---
title: 'humanitarian-mcp: a Model Context Protocol server for humanitarian open data'
tags:
  - humanitarian data
  - forced displacement
  - refugees
  - Model Context Protocol
  - large language models
  - open data
  - TypeScript
authors:
  - name: Ahmed Nabil
    affiliation: 1
affiliations:
  - name: Independent Researcher
    index: 1
date: 10 July 2026
bibliography: paper.bib
---

# Summary

`humanitarian-mcp` is an open-source server that exposes trusted humanitarian
open datasets to AI assistants and analysis scripts through the Model Context
Protocol (MCP) [@mcp]. It currently serves four sources behind one uniform,
read-only interface: the UNHCR Refugee Statistics API [@unhcr_rdf] (75 years
of forced-displacement statistics), the World Bank Indicators API
[@worldbank] (population, GDP and poverty denominators), HDX HAPI
[@hapi] (conflict events from ACLED [@acled], IPC food-security phases
[@ipc], OCHA FTS humanitarian funding and IOM DTM internal-displacement
stocks), and ReliefWeb [@reliefweb] (situation-report counts and links that
ground the statistics in published operational reporting).

The server presents 21 semantic tools — country profiles, comparisons,
trend analysis with anomaly detection, per-capita normalization, rankings,
situation-report retrieval, charts, maps and exports — that return normalized records with consistent
fields (`country_code` as ISO3, `year`, `population`, per-dataset `metrics`,
`source`). Every export can attach an _extraction manifest_ (the exact tool
arguments, timestamp, server version and citation) and a variable-level
_codebook_, turning each data pull into a repeatable extraction recipe
suitable for a paper's appendix. Country names resolve in English and
Arabic. The system is read-only, rate-limited and cached, with a full
offline mode for fieldwork settings.

# Statement of need

Humanitarian data is public but hostile to programmatic reuse, and doubly so
to reuse mediated by large language models. UNHCR's API, for instance, uses
its own three-letter country codes that disagree with ISO 3166-1 alpha-3 for
99 of 232 countries — Egypt is `ARE` in UNHCR's scheme, which is the United
Arab Emirates' ISO code — while numeric cells arrive as numbers, numeric
strings or `"-"`, and most query mistakes return silently empty results
rather than errors. Researchers who point an AI assistant (or their own
scripts) at these APIs re-discover the same traps in every session, and
subtle failures produce plausible-looking but wrong numbers.

`humanitarian-mcp` encodes these quirks once, at the provider layer, and
exposes only normalized records above it. Three design invariants hold
throughout: nothing provider-specific leaks outside a provider's module;
every tool is read-only and annotated as such; and errors reach the caller
as actionable text. Aggregation semantics that are easy to get wrong are
encoded per dataset: internal-displacement assessment rounds are never
summed (the latest round per year wins), funding coverage is recomputed from
summed appeals rather than averaged, and IPC current analyses take
precedence over projections. Statistical anomalies flagged by the trend
tools can be grounded in contemporaneous situation reports retrieved from
ReliefWeb, so a detected break in a displacement series links directly to
the operational reporting published at the time.

The per-capita normalization addresses a recurring analytical error in
public discussion of displacement: absolute hosting numbers dominate
headlines, while the hosting _burden_ — refugees per 1,000 residents or per
unit of GDP — reorders the picture toward countries such as Lebanon, Jordan
and Chad. `humanitarian-mcp` matches denominators per year (2015 refugees
over 2015 population) and discloses the denominator year on every row.

The intended users are (i) quantitative researchers in forced-migration
studies, who gain reproducible, citable extractions that join cleanly with
external panels on ISO3 codes; (ii) analysts in humanitarian organisations,
who can self-host the server (a Docker image is provided) and query five
crisis dimensions — displacement, conflict, hunger, funding and situation
reporting — through one interface; and (iii) anyone using MCP-capable AI assistants, for whom the
assistant's answers inherit the server's normalization and provenance
instead of improvising against raw APIs.

# Comparison with existing software

Existing open-source clients for these sources are per-source and
per-language: the `refugees` R package [@refugees_r] and UNHCR's data
packages wrap the Refugee Statistics API for R; `hdx-python-api`
[@hdx_python] wraps HDX for Python; the World Bank has clients in most
languages. `humanitarian-mcp` differs in three ways: it is _cross-source_
(one normalized record shape and one country-code scheme across providers,
with cross-source denominators built in); it is _protocol-first_ (any
MCP-capable client — AI assistants, editors, agent frameworks — gets the
full toolset without language bindings); and it is _reproducibility-first_
(manifests and codebooks are attached to the data itself rather than left to
the analyst's discipline). To our knowledge it is the first MCP server over
humanitarian statistical APIs.

# Quality control

The test suite (150+ tests) includes an MCP compliance suite that drives the
real server through the official protocol SDK over an in-memory transport,
provider suites that replay recorded upstream fixtures with no network
access (covering code translation, malformed cells, aggregate filtering and
each dataset's aggregation semantics), and unit tests for the statistics,
normalization and Arabic-matching layers. Continuous integration runs
typechecking, linting and the full suite on Node 20, 22 and 24. Runnable
Python and R notebooks reproduce four research workflows end-to-end against
a local server.

# AI usage disclosure

Generative AI (Anthropic Claude, 2025–2026 model family) was used
substantially throughout this project: code generation and refactoring,
test scaffolding, documentation, and drafting of this manuscript. The
author framed the problem, set the design invariants and architectural
decisions (provider isolation, read-only semantics, per-dataset
aggregation rules), reviewed, edited and validated all AI-assisted
outputs, and verified results against the live upstream APIs. The author
takes full responsibility for the accuracy, originality and licensing of
all submitted materials.

# Acknowledgements

This project builds on the public data infrastructure maintained by UNHCR,
the World Bank, the Centre for Humanitarian Data (HDX), ACLED, the IPC
partnership, OCHA and IOM. The figures these services publish represent
people; the software aims to help present them with the care they deserve.

# References
