/**
 * English message catalog — the reference catalog. Every other locale must
 * provide exactly the same keys with the same function signatures (enforced
 * by the `Messages` type and by tests/unit/i18n.test.ts).
 *
 * Conventions:
 *  - Functions receive values that are ALREADY formatted by the translator
 *    (numbers, years, ranges, country names), so catalogs never format.
 *  - English output intentionally matches the pre-i18n wording byte-for-byte.
 */
export const en = {
  meta: {
    /** Display raw metric keys (e.g. `refugees`) instead of translated labels. */
    showMetricKeys: true as boolean,
    listSeparator: ', ',
    dotSeparator: ' · ',
  },
  common: {
    noData: '_No data._',
    noRecentData: '_No recent data._',
    na: 'n/a',
    year: 'Year',
    country: 'Country',
    indicator: 'Indicator',
    people: 'People',
    peopleInYear: (year: string) => `People (${year})`,
    origin: 'Origin',
    refugees: 'Refugees',
    region: 'Region',
    source: 'Source',
    total: 'Total',
    sourceLine: (citation: string, _producer: string) => `_Source: ${citation}_`,
    range: (from: string, to: string) => `${from}–${to}`,
    side: (role: 'asylum' | 'origin') => ` (${role} side)`,
    truncatedNote: '\n\n_Note: very large result set; totals are truncated._',
  },
  units: {
    people: 'people',
    population: 'per 1,000 residents',
    gdp: 'per US$1bn GDP',
  },
  denominators: {
    kind: { population: 'population', gdp: 'gdp' } as Record<'population' | 'gdp', string>,
    valuesNote: (unit: string, kind: string, citation: string) =>
      `\n\n_Values are ${unit} — ${kind} denominators matched per year (${citation})._`,
    missingNote: (codes: string) =>
      `\n\n_No denominator data for: ${codes} — omitted from normalized series._`,
    rankedNote: (unit: string, kind: string, citation: string, year: string) =>
      `\n\n_Ranked ${unit} — ${kind} denominators from ${citation}. Denominator years shown per row when they trail ${year}._`,
    skippedNote: (count: string) =>
      `\n\n_${count} countries had no denominator data and were omitted._`,
  },
  search: {
    match: 'Match',
  },
  profile: {
    title: (name: string, year: string | undefined) =>
      `# ${name} — humanitarian profile${year ? ` (${year})` : ''}`,
    infoLine: (region: string, iso3: string, source: string) =>
      `**Region:** ${region} · **ISO3:** ${iso3} · **Source:** ${source}`,
    hosted: '## Hosted in the country',
    abroad: '## Displaced from the country',
    topOrigins: '## Top origins of refugees hosted',
  },
  compare: {
    heading: (metric: string, unit: string | undefined, side: string, range: string) =>
      `**${metric}**${unit ? ` (${unit})` : ''}${side}, ${range}`,
    latest: (year: string, summary: string) => `Latest (${year}): ${summary}`,
    noOverlap: 'no overlapping data',
  },
  population: {
    heading: (name: string, side: string, range: string) =>
      `Displacement figures — **${name}**${side}, ${range}`,
    headers: ['Year', 'Refugees', 'Asylum-seekers', 'IDPs', 'Stateless', 'Total of concern'] as [
      string,
      string,
      string,
      string,
      string,
      string,
    ],
  },
  demographics: {
    noData: (name: string, role: string) =>
      `No recent demographic data for ${name} on the ${role} side. UNHCR demographics cover recent years only — try the refugee_population tool for totals.`,
    headers: ['Age group', 'Female', 'Male', 'Share of total'] as [string, string, string, string],
    heading: (name: string, side: string, year: string) =>
      `Demographics — **${name}**${side}, ${year}`,
    totalLine: (total: string, pctFemale: string) => `Total: **${total}** (${pctFemale} female)`,
    female: 'Female',
    male: 'Male',
    age: {
      '0_4': '0–4',
      '5_11': '5–11',
      '12_17': '12–17',
      '18_59': '18–59',
      '60': '60+',
      other: 'age unknown',
      total: 'all ages',
    } as Record<string, string>,
  },
  latest: {
    global: 'Global',
    noData: (scope: string) => `No recent statistics found for ${scope}.`,
    heading: (scope: string, side: string, year: string) =>
      `Latest statistics — **${scope}**${side}, ${year}`,
  },
  asylum: {
    applications: 'Applications',
    applicationsHeading: (name: string, side: string, range: string) =>
      `Asylum applications — **${name}**${side}, ${range}`,
    decisionHeaders: [
      'Year',
      'Recognized',
      'Complementary',
      'Rejected',
      'Closed',
      'Total',
      'Recognition rate',
    ] as [string, string, string, string, string, string, string],
    decisionsHeading: (name: string, side: string, range: string) =>
      `Asylum decisions — **${name}**${side}, ${range}`,
    recognitionNote: (citation: string, _producer: string) =>
      `_Recognition rate = (recognized + complementary) / substantive decisions. Source: ${citation}_`,
  },
  solutions: {
    heading: (name: string, side: string, range: string) =>
      `Durable solutions — **${name}**${side}, ${range}`,
    headers: [
      'Year',
      'Refugee returns',
      'Resettlement',
      'Naturalisation',
      'IDP returns',
      'Total solutions',
    ] as [string, string, string, string, string, string],
    normalizedHeader: (unit: string) => `Total ${unit}`,
    periodTotal: 'Period total',
    noData: (name: string, side: string, range: string) =>
      `No durable-solutions data for ${name}${side} in ${range}. UNHCR reports returns, resettlement and naturalisation only where they occurred — try role="origin" or a wider year range.`,
    perspective: {
      origin: (name: string) =>
        `_Origin view: refugees who returned to ${name}, nationals of ${name} resettled or naturalised abroad, and IDP returns inside ${name}._`,
      asylum: (name: string) =>
        `_Asylum view: refugees who left ${name} to return home, people resettled to ${name}, people naturalised in ${name}, and IDP returns inside ${name}._`,
    } as Record<'asylum' | 'origin', (name: string) => string>,
    mixLine: (items: string) => `**Mix over the period:** ${items}`,
    flowNote:
      '_Durable solutions are flows recorded during each year, not end-year stocks, so summing across years is meaningful (unlike refugee_population). "—" = not reported by UNHCR, which is not the same as zero._',
  },
  trend: {
    noData: (metric: string, name: string, side: string, range: string) =>
      `No ${metric} data for ${name}${side} in ${range}.`,
    deltaPrev: 'Δ vs prev',
    deltaPct: 'Δ %',
    noneDetected: 'none detected',
    anomaly: (year: string, change: string, z: string) => `${year} (${change}, z=${z})`,
    heading: (metric: string, name: string, side: string, range: string) =>
      `Trend — **${metric}**, ${name}${side}, ${range}`,
    direction: {
      increasing: 'increasing',
      decreasing: 'decreasing',
      stable: 'stable',
    } as Record<'increasing' | 'decreasing' | 'stable', string>,
    directionLine: (direction: string, slope: string, r2: string) =>
      `**Direction:** ${direction} (${slope}/year, R²=${r2})`,
    cagrLine: (cagr: string) => `**CAGR:** ${cagr}`,
    anomaliesLine: (text: string) => `**Anomalous years:** ${text}`,
  },
  forecast: {
    notEnough: (metric: string, name: string, found: string) =>
      `Not enough history to project ${metric} for ${name} (need ≥3 data points, found ${found}).`,
    caveat:
      'Naive linear extrapolation of historical UNHCR data. Displacement is driven by events a straight line cannot anticipate; treat as an order-of-magnitude indication only.',
    type: 'Type',
    observed: 'observed',
    projected: 'projected',
    heading: (metric: string, name: string) => `Projection — **${metric}**, ${name}`,
  },
  ranking: {
    noLatestYear: 'Could not determine the latest data year.',
    denomYear: 'Denom. year',
    heading: (
      count: string,
      by: 'asylum' | 'origin',
      metric: string,
      unit: string | undefined,
      year: string,
    ) =>
      `Top ${count} ${by === 'asylum' ? 'host' : 'origin'} countries by **${metric}**${unit ? ` (${unit})` : ''}, ${year}`,
  },
  crisis: {
    conflictNoData: (name: string, range: string) =>
      `No conflict-event data for ${name} in ${range}. Coverage follows ACLED via HDX; try a wider year range.`,
    conflictHeaders: ['Year', 'Events', 'Fatalities'] as [string, string, string],
    conflictHeading: (name: string, range: string) => `Conflict events — **${name}**, ${range}`,
    foodNoData: (name: string, year: string | undefined) =>
      `No IPC food-security data for ${name}${year ? ` in ${year}` : ''}. IPC covers countries with active analyses only.`,
    ipcPhase: 'IPC phase',
    ipcPhases: {
      ipc_phase_1: 'Phase 1 — minimal',
      ipc_phase_2: 'Phase 2 — stressed',
      ipc_phase_3: 'Phase 3 — crisis',
      ipc_phase_4: 'Phase 4 — emergency',
      ipc_phase_5: 'Phase 5 — catastrophe',
    } as Record<string, string>,
    foodHeading: (name: string, year: string) => `Food security — **${name}**, ${year}`,
    crisisOrWorse: (people: string) => `In crisis or worse (IPC 3+): **${people}**`,
    fundingNoData: (name: string, range: string) =>
      `No humanitarian funding data for ${name} in ${range}. FTS tracks countries with coordinated appeals.`,
    fundingHeaders: ['Year', 'Required (US$)', 'Funded (US$)', 'Coverage'] as [
      string,
      string,
      string,
      string,
    ],
    fundingHeading: (name: string, range: string) => `Humanitarian funding — **${name}**, ${range}`,
    reportsNoData: (name: string, range: string) =>
      `No situation reports found for ${name} in ${range}. ReliefWeb coverage varies by crisis; try a wider year range, or check provider_health if this persists.`,
    reportsHeader: 'Reports',
    undated: 'undated',
    latestReports: (query: string | undefined) =>
      `**Latest reports**${query ? ` matching "${query}"` : ''}`,
    noneInRange: '_none in range_',
    reportsHeading: (name: string, range: string) => `Situation reports — **${name}**, ${range}`,
  },
  charts: {
    noData: (metric: string, range: string) =>
      `No ${metric} data found for those countries in ${range}.`,
    title: (metricLabel: string, side: string, range: string, source: string) =>
      `${metricLabel}${side}, ${range} — ${source}`,
    chartjsIntro: (title: string) => `Chart.js v4 config for "${title}":`,
    vegaIntro: (title: string) => `Vega-Lite v5 spec for "${title}":`,
    svgIntro: (title: string) => `SVG chart for "${title}":`,
    mapHeading: (
      count: string,
      by: 'asylum' | 'origin',
      metric: string,
      year: string,
      features: string,
      skipped: string | undefined,
    ) =>
      `GeoJSON map — top ${count} ${by === 'asylum' ? 'host' : 'origin'} countries by ${metric}, ${year} (${features} features${skipped ? `; no centroid for: ${skipped}` : ''})`,
    refugeesHostedIn: (name: string) => `Refugees hosted in ${name}`,
    millions: (v: string) => `${v}M`,
    thousands: (v: string) => `${v}k`,
  },
  report: {
    progress: {
      history: 'Fetching displacement history',
      origins: 'Fetching origin breakdown',
      asylum: 'Fetching asylum figures',
      demographics: 'Fetching demographics',
      composing: 'Composing report',
    },
    title: (name: string) => `# ${name} — Humanitarian Situation Report`,
    generatedBy: (citation: string, range: string) =>
      `> Generated by malja-mcp · Source: ${citation} · Range ${range}`,
    keyFigures: '## Key figures',
    noDisplacement: '_No displacement data in range._',
    overTime: '## Refugee population over time',
    trendLine: (direction: 'increasing' | 'decreasing', slope: string, r2: string) =>
      `Trend: ${direction} by ≈${slope} people/year (R²=${r2}).`,
    lastChange: (pct: string) => ` Last year-over-year change: ${pct}.`,
    noRefugees: '_No refugee data in range._',
    whereFrom: '## Where refugees come from',
    decisions: '## Asylum decisions (last 5 years)',
    decisionHeaders: ['Year', 'Recognized', 'Rejected', 'Closed', 'Total'] as [
      string,
      string,
      string,
      string,
      string,
    ],
    noDecisions: '_No asylum decision data in range._',
    demographics: '## Demographics',
    asOf: (year: string, total: string) => `As of ${year}: **${total}** people of concern`,
    shares: (female: string, children: string) =>
      `, ${female} female, ${children} children (0–17).`,
    noDemographics: '_No recent demographic breakdown available._',
    methodNotes:
      '_Method notes: figures are end-year stocks from UNHCR. "Total of concern" sums refugees, asylum-seekers, IDPs, stateless, others of concern and other people in need of international protection. Generated report — verify against unhcr.org/refugee-statistics before publication._',
  },
  exports: {
    csvIntro: (dataset: string, rows: string, withManifest: boolean) =>
      `CSV export — ${dataset}, ${rows} rows${withManifest ? ' (manifest in `#` comment lines — read with `comment="#"`)' : ''}:`,
    jsonIntro: (dataset: string, rows: string) => `JSON export — ${dataset}, ${rows} rows:`,
    geojsonIntro: (dataset: string, features: string, skipped: string | undefined) =>
      `GeoJSON export — ${dataset}, ${features} features${skipped ? ` (no centroid: ${skipped})` : ''}:`,
    manifestLabel: 'Extraction manifest',
    codebookHeading: '## Codebook',
    truncated: (rows: string) =>
      `_Note: output truncated to ${rows} rows. Narrow the year range or filter by country for a complete set._`,
  },
  codebook: {
    headers: ['Variable', 'Description', 'Unit'] as [string, string, string],
    units: {
      text: 'text',
      ISO3: 'ISO3',
      year: 'year',
      id: 'id',
      'ISO timestamp': 'ISO timestamp',
      persons: 'persons',
      applications: 'applications',
      decisions: 'decisions',
      'current US$': 'current US$',
      '% of population': '% of population',
      events: 'events',
      '%': '%',
      reports: 'reports',
    } as Record<string, string>,
    fields: {
      country: 'Display name of the country the row is about.',
      country_code: 'ISO 3166-1 alpha-3 country code.',
      origin: 'Country of origin, where the dataset distinguishes origin vs asylum.',
      origin_code: 'ISO3 code of the country of origin.',
      asylum: 'Country of asylum (hosting country).',
      asylum_code: 'ISO3 code of the country of asylum.',
      year: 'Reference year of the observation.',
      source: 'Provider id that served the row (see get_metadata).',
      last_updated:
        'When this row was fetched/normalized by the server — record it; upstream series are revised.',
      dataset: 'Dataset id the row belongs to.',
      refugees: 'Refugees under UNHCR mandate, end-year stock.',
      asylum_seekers: 'People with pending asylum claims.',
      returned_refugees: 'Refugees who returned during the year.',
      idps: 'Internally displaced people (UNHCR-protected).',
      returned_idps: 'IDPs who returned during the year.',
      resettlement:
        'Refugees resettled to a third country during the year (flow). Asylum side = resettlement country.',
      naturalisation:
        'Refugees who acquired the nationality of their asylum country during the year (flow).',
      stateless: 'People without a recognized nationality.',
      ooc: 'Others of concern to UNHCR.',
      oip: 'Other people in need of international protection.',
      hst: 'Host-community members UNHCR assists.',
      applied: 'Individual asylum applications lodged in the year.',
      dec_recognized: 'Applications recognized (refugee status granted).',
      dec_other: 'Complementary/subsidiary protection granted.',
      dec_rejected: 'Applications rejected.',
      dec_closed: 'Otherwise closed (withdrawn, abandoned...).',
      dec_total: 'All decisions in the year.',
      national_population: 'Total national population (World Bank SP.POP.TOTL).',
      gdp_usd: 'GDP, current prices (World Bank NY.GDP.MKTP.CD).',
      gdp_per_capita_usd: 'GDP per capita, current prices (NY.GDP.PCAP.CD).',
      poverty_rate_pct: 'Poverty headcount at $2.15/day, 2017 PPP (SI.POV.DDAY).',
      idps_hdx: 'IDP stock, latest assessment of the year (rounds are not summed).',
      events: 'Conflict events in the year (monthly/event-type rows summed).',
      fatalities: 'Reported conflict fatalities in the year.',
      requirements_usd: 'Appeal requirements, all appeals summed per year.',
      funding_usd: 'Funding received, all appeals summed per year.',
      funding_coverage_pct:
        'funding_usd / requirements_usd × 100, recomputed after summing (never averaged).',
      ipc_phase_1: 'People in IPC phase 1 (minimal).',
      ipc_phase_2: 'People in IPC phase 2 (stressed).',
      ipc_phase_3: 'People in IPC phase 3 (crisis).',
      ipc_phase_4: 'People in IPC phase 4 (emergency).',
      ipc_phase_5: 'People in IPC phase 5 (catastrophe).',
      ipc_phase_3plus: 'People in phase 3 or worse — the headline figure.',
      analyzed_population: 'Population covered by the IPC analysis.',
      reports: 'Situation reports published on ReliefWeb for the country-year.',
      demographics_total: 'Total people covered.',
    } as Record<string, string>,
    demographic: (sex: string, ageLabel: string) => `${sex} people aged ${ageLabel}.`,
    headlinePrefix: (text: string) => `Headline figure — ${text}`,
    headlineFallback: 'dataset-specific total.',
    headline: {
      population:
        'Sum of all people-of-concern categories in the row (refugees + asylum-seekers + IDPs + stateless + others).',
      demographics: 'Total people covered by the age/sex breakdown.',
      'asylum-applications': 'Asylum applications lodged.',
      'asylum-decisions': 'Total substantive decisions.',
      solutions:
        'Sum of durable solutions recorded in the year (refugee returns + resettlement + naturalisation + IDP returns) — a flow, not a stock.',
      'context-indicators': 'National population (SP.POP.TOTL).',
      idps: 'Internally displaced people (latest assessment of the year).',
      'conflict-events': 'Conflict events recorded in the year.',
      'humanitarian-funding': 'Humanitarian funding received (current US$).',
      'food-security': 'People in IPC phase 3 or worse (crisis or worse).',
      'situation-reports': 'Situation reports published about the country in the year.',
    } as Record<string, string>,
  },
  metadata: {
    headers: ['Dataset', 'Metrics', 'Description'] as [string, string, string],
    healthHeaders: ['Provider', 'Status', 'Latency', 'Detail'] as [string, string, string, string],
    ok: '✅ ok',
    down: '❌ down',
    ms: (v: string) => `${v} ms`,
  },
  errors: {
    countryNotFound: (query: string, suggestions: string | undefined) =>
      `No country matched "${query}".${suggestions ? ` Did you mean: ${suggestions}?` : ''} Try the search_country tool first.`,
    offlineMiss: (detail: string) =>
      `Offline mode is enabled and this data is not cached yet: ${detail}`,
    rateLimited: (provider: string) =>
      `The ${provider} provider is rate limiting requests. Retry shortly.`,
    network: (provider: string, detail: string) =>
      `Could not reach the ${provider} provider: ${detail}`,
    upstream: (provider: string, detail: string) =>
      `The ${provider} provider returned an error: ${detail}`,
    defaultProvider: 'data',
    yearRange: (from: string, to: string) =>
      `year_from (${from}) must not be after year_to (${to})`,
    denominatorsUnavailable:
      'normalize_by needs the "context-indicators" dataset. Enable the World Bank provider: MALJA_PROVIDERS=unhcr,worldbank',
  },
  prompts: {
    respondIn: '',
  },
  /** Metric key → human label (used when meta.showMetricKeys is false). */
  metrics: {
    refugees: 'Refugees',
    asylum_seekers: 'Asylum-seekers',
    returned_refugees: 'Returned refugees',
    idps: 'Internally displaced people (IDPs)',
    returned_idps: 'Returned IDPs',
    resettlement: 'Resettlement',
    naturalisation: 'Naturalisation',
    stateless: 'Stateless people',
    ooc: 'Others of concern',
    oip: 'Other people in need of international protection',
    hst: 'Host community',
    applied: 'Asylum applications',
    dec_recognized: 'Recognized',
    dec_other: 'Complementary protection',
    dec_rejected: 'Rejected',
    dec_closed: 'Otherwise closed',
    dec_total: 'Total decisions',
    national_population: 'National population',
    gdp_usd: 'GDP (US$)',
    gdp_per_capita_usd: 'GDP per capita (US$)',
    poverty_rate_pct: 'Poverty rate (%)',
    events: 'Conflict events',
    fatalities: 'Fatalities',
    requirements_usd: 'Requirements (US$)',
    funding_usd: 'Funding received (US$)',
    funding_coverage_pct: 'Funding coverage (%)',
    ipc_phase_1: 'IPC phase 1 (minimal)',
    ipc_phase_2: 'IPC phase 2 (stressed)',
    ipc_phase_3: 'IPC phase 3 (crisis)',
    ipc_phase_4: 'IPC phase 4 (emergency)',
    ipc_phase_5: 'IPC phase 5 (catastrophe/famine)',
    ipc_phase_3plus: 'IPC phase 3+ (crisis or worse)',
    analyzed_population: 'Population analysed',
    reports: 'Situation reports',
    total: 'Total',
  } as Record<string, string>,
  datasets: {
    population: 'Forcibly displaced and stateless populations',
    demographics: 'Demographics (age and sex)',
    'asylum-applications': 'Asylum applications',
    'asylum-decisions': 'Asylum decisions',
    solutions: 'Durable solutions (returns, resettlement, naturalisation)',
    'context-indicators': 'Context indicators (population, GDP)',
    idps: 'Internally displaced people',
    'conflict-events': 'Conflict events',
    'humanitarian-funding': 'Humanitarian funding',
    'food-security': 'Food security (IPC)',
    'situation-reports': 'Situation reports',
  } as Record<string, string>,
  /** Provider id → producer name used in citations. */
  producers: {
    unhcr: 'UNHCR',
    worldbank: 'World Bank',
    hdx: 'HDX',
    reliefweb: 'ReliefWeb',
  } as Record<string, string>,
  regions: {
    Africa: 'Africa',
    Asia: 'Asia',
    Europe: 'Europe',
    Oceania: 'Oceania',
    'Latin America and the Caribbean': 'Latin America and the Caribbean',
    'Northern America': 'Northern America',
    Stateless: 'Stateless',
    Various: 'Various',
    'Middle East & North Africa': 'Middle East & North Africa',
    'Sub-Saharan Africa': 'Sub-Saharan Africa',
    'Europe & Central Asia': 'Europe & Central Asia',
    'East Asia & Pacific': 'East Asia & Pacific',
    'South Asia': 'South Asia',
    'Latin America & Caribbean': 'Latin America & Caribbean',
    'North America': 'North America',
  } as Record<string, string>,
};

export type Messages = typeof en;
