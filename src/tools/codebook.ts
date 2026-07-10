import type { DatasetId } from '../providers/types.js';
import { markdownTable } from '../viz/table.js';

/**
 * Variable-level documentation for exports: what each column means, its unit
 * and how derived values are computed. This is the codebook a paper's data
 * appendix needs — generated to match exactly the columns of the export it
 * accompanies, never a generic glossary dump.
 */

export interface CodebookEntry {
  field: string;
  description: string;
  unit: string;
}

const BASE_FIELDS: CodebookEntry[] = [
  { field: 'country', description: 'Display name of the country the row is about.', unit: 'text' },
  { field: 'country_code', description: 'ISO 3166-1 alpha-3 country code.', unit: 'ISO3' },
  {
    field: 'origin',
    description: 'Country of origin, where the dataset distinguishes origin vs asylum.',
    unit: 'text',
  },
  { field: 'origin_code', description: 'ISO3 code of the country of origin.', unit: 'ISO3' },
  { field: 'asylum', description: 'Country of asylum (hosting country).', unit: 'text' },
  { field: 'asylum_code', description: 'ISO3 code of the country of asylum.', unit: 'ISO3' },
  { field: 'year', description: 'Reference year of the observation.', unit: 'year' },
  {
    field: 'source',
    description: 'Provider id that served the row (see get_metadata).',
    unit: 'id',
  },
  {
    field: 'last_updated',
    description:
      'When this row was fetched/normalized by the server — record it; upstream series are revised.',
    unit: 'ISO timestamp',
  },
  { field: 'dataset', description: 'Dataset id the row belongs to.', unit: 'id' },
];

/** What the headline `population` column means, per dataset. */
const HEADLINE: Partial<Record<DatasetId, string>> = {
  population:
    'Sum of all people-of-concern categories in the row (refugees + asylum-seekers + IDPs + stateless + others).',
  demographics: 'Total people covered by the age/sex breakdown.',
  'asylum-applications': 'Asylum applications lodged.',
  'asylum-decisions': 'Total substantive decisions.',
  'context-indicators': 'National population (SP.POP.TOTL).',
  idps: 'Internally displaced people (latest assessment of the year).',
  'conflict-events': 'Conflict events recorded in the year.',
  'humanitarian-funding': 'Humanitarian funding received (current US$).',
  'food-security': 'People in IPC phase 3 or worse (crisis or worse).',
  'situation-reports': 'Situation reports published about the country in the year.',
};

const METRIC_FIELDS: Partial<Record<DatasetId, CodebookEntry[]>> = {
  population: [
    {
      field: 'refugees',
      description: 'Refugees under UNHCR mandate, end-year stock.',
      unit: 'persons',
    },
    { field: 'asylum_seekers', description: 'People with pending asylum claims.', unit: 'persons' },
    {
      field: 'returned_refugees',
      description: 'Refugees who returned during the year.',
      unit: 'persons',
    },
    {
      field: 'idps',
      description: 'Internally displaced people (UNHCR-protected).',
      unit: 'persons',
    },
    { field: 'returned_idps', description: 'IDPs who returned during the year.', unit: 'persons' },
    {
      field: 'stateless',
      description: 'People without a recognized nationality.',
      unit: 'persons',
    },
    { field: 'ooc', description: 'Others of concern to UNHCR.', unit: 'persons' },
    {
      field: 'oip',
      description: 'Other people in need of international protection.',
      unit: 'persons',
    },
    { field: 'hst', description: 'Host-community members UNHCR assists.', unit: 'persons' },
  ],
  'asylum-applications': [
    {
      field: 'applied',
      description: 'Individual asylum applications lodged in the year.',
      unit: 'applications',
    },
  ],
  'asylum-decisions': [
    {
      field: 'dec_recognized',
      description: 'Applications recognized (refugee status granted).',
      unit: 'decisions',
    },
    {
      field: 'dec_other',
      description: 'Complementary/subsidiary protection granted.',
      unit: 'decisions',
    },
    { field: 'dec_rejected', description: 'Applications rejected.', unit: 'decisions' },
    {
      field: 'dec_closed',
      description: 'Otherwise closed (withdrawn, abandoned...).',
      unit: 'decisions',
    },
    { field: 'dec_total', description: 'All decisions in the year.', unit: 'decisions' },
  ],
  'context-indicators': [
    {
      field: 'national_population',
      description: 'Total national population (World Bank SP.POP.TOTL).',
      unit: 'persons',
    },
    {
      field: 'gdp_usd',
      description: 'GDP, current prices (World Bank NY.GDP.MKTP.CD).',
      unit: 'current US$',
    },
    {
      field: 'gdp_per_capita_usd',
      description: 'GDP per capita, current prices (NY.GDP.PCAP.CD).',
      unit: 'current US$',
    },
    {
      field: 'poverty_rate_pct',
      description: 'Poverty headcount at $2.15/day, 2017 PPP (SI.POV.DDAY).',
      unit: '% of population',
    },
  ],
  idps: [
    {
      field: 'idps',
      description: 'IDP stock, latest assessment of the year (rounds are not summed).',
      unit: 'persons',
    },
  ],
  'conflict-events': [
    {
      field: 'events',
      description: 'Conflict events in the year (monthly/event-type rows summed).',
      unit: 'events',
    },
    {
      field: 'fatalities',
      description: 'Reported conflict fatalities in the year.',
      unit: 'persons',
    },
  ],
  'humanitarian-funding': [
    {
      field: 'requirements_usd',
      description: 'Appeal requirements, all appeals summed per year.',
      unit: 'current US$',
    },
    {
      field: 'funding_usd',
      description: 'Funding received, all appeals summed per year.',
      unit: 'current US$',
    },
    {
      field: 'funding_coverage_pct',
      description:
        'funding_usd / requirements_usd × 100, recomputed after summing (never averaged).',
      unit: '%',
    },
  ],
  'food-security': [
    { field: 'ipc_phase_1', description: 'People in IPC phase 1 (minimal).', unit: 'persons' },
    { field: 'ipc_phase_2', description: 'People in IPC phase 2 (stressed).', unit: 'persons' },
    { field: 'ipc_phase_3', description: 'People in IPC phase 3 (crisis).', unit: 'persons' },
    { field: 'ipc_phase_4', description: 'People in IPC phase 4 (emergency).', unit: 'persons' },
    { field: 'ipc_phase_5', description: 'People in IPC phase 5 (catastrophe).', unit: 'persons' },
    {
      field: 'ipc_phase_3plus',
      description: 'People in phase 3 or worse — the headline figure.',
      unit: 'persons',
    },
    {
      field: 'analyzed_population',
      description: 'Population covered by the IPC analysis.',
      unit: 'persons',
    },
  ],
  'situation-reports': [
    {
      field: 'reports',
      description: 'Situation reports published on ReliefWeb for the country-year.',
      unit: 'reports',
    },
  ],
};

/** Demographics buckets are generated (f_/m_ × age ranges) — build on demand. */
function demographicEntries(): CodebookEntry[] {
  const buckets: [string, string][] = [
    ['0_4', '0–4'],
    ['5_11', '5–11'],
    ['12_17', '12–17'],
    ['18_59', '18–59'],
    ['60', '60+'],
    ['other', 'age unknown'],
    ['total', 'all ages'],
  ];
  return ['f', 'm'].flatMap((sex) =>
    buckets.map(([key, label]) => ({
      field: `${sex}_${key}`,
      description: `${sex === 'f' ? 'Female' : 'Male'} people aged ${label}.`,
      unit: 'persons',
    })),
  );
}

/**
 * Codebook rows for a dataset, restricted to fields actually present in the
 * export so it documents exactly what the reader holds.
 */
export function buildCodebook(
  dataset: DatasetId,
  presentFields: readonly string[],
): CodebookEntry[] {
  const metricEntries =
    dataset === 'demographics'
      ? [
          ...demographicEntries(),
          { field: 'total', description: 'Total people covered.', unit: 'persons' },
        ]
      : (METRIC_FIELDS[dataset] ?? []);
  const population: CodebookEntry = {
    field: 'population',
    description: `Headline figure — ${HEADLINE[dataset] ?? 'dataset-specific total.'}`,
    unit: 'persons',
  };
  const all = [...BASE_FIELDS, population, ...metricEntries];
  const present = new Set(presentFields);
  return all.filter((entry) => present.has(entry.field));
}

/** Codebook as a markdown table (for tool text output and appendices). */
export function codebookMarkdown(entries: readonly CodebookEntry[]): string {
  return markdownTable(
    ['Variable', 'Description', 'Unit'],
    entries.map((e) => [e.field, e.description, e.unit]),
  );
}
