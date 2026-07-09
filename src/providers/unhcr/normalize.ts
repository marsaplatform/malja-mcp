import type { DatasetId, NormalizedRecord } from '../types.js';

/**
 * Pure conversion of raw UNHCR rows into {@link NormalizedRecord}s.
 *
 * UNHCR quirks handled here so nothing downstream sees them:
 *  - numbers arrive as numbers, numeric strings ("0") or "-" (no data)
 *  - rows carry both a UNHCR code and an ISO code per side (coo/coa)
 *  - the aggregated side of a query is marked with "-" placeholders
 */

interface UnhcrSide {
  name?: string;
  iso?: string;
}

interface ParsedRow {
  year: number;
  origin: UnhcrSide;
  asylum: UnhcrSide;
  metrics: Record<string, number>;
}

/** UNHCR numeric cell → number, or undefined for "-" / missing / garbage. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.trim() === '' || value === '-') return undefined;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const POPULATION_METRICS = [
  'refugees',
  'asylum_seekers',
  'returned_refugees',
  'idps',
  'returned_idps',
  'stateless',
  'ooc',
  'oip',
  'hst',
] as const;

/** Metrics counted into the headline `population` figure (people of concern). */
const POPULATION_HEADLINE = ['refugees', 'asylum_seekers', 'idps', 'stateless', 'ooc', 'oip'];

const DEMOGRAPHIC_METRICS = [
  'f_0_4',
  'f_5_11',
  'f_12_17',
  'f_18_59',
  'f_60',
  'f_other',
  'f_total',
  'm_0_4',
  'm_5_11',
  'm_12_17',
  'm_18_59',
  'm_60',
  'm_other',
  'm_total',
  'total',
] as const;

const APPLICATION_METRICS = ['applied'] as const;

const DECISION_METRICS = [
  'dec_recognized',
  'dec_other',
  'dec_rejected',
  'dec_closed',
  'dec_total',
] as const;

const METRIC_KEYS: Partial<Record<DatasetId, readonly string[]>> = {
  population: POPULATION_METRICS,
  demographics: DEMOGRAPHIC_METRICS,
  'asylum-applications': APPLICATION_METRICS,
  'asylum-decisions': DECISION_METRICS,
};

function parseSide(row: Record<string, unknown>, prefix: 'coo' | 'coa'): UnhcrSide {
  const name = row[`${prefix}_name`];
  const iso = row[`${prefix}_iso`];
  const side: UnhcrSide = {};
  if (typeof name === 'string' && name !== '-') side.name = name;
  if (typeof iso === 'string' && iso !== '-') side.iso = iso;
  return side;
}

function parseRow(raw: unknown, dataset: DatasetId): ParsedRow | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const year = toNumber(row['year']);
  if (year === undefined) return undefined;

  const metrics: Record<string, number> = {};
  for (const key of METRIC_KEYS[dataset] ?? []) {
    const value = toNumber(row[key]);
    if (value !== undefined) metrics[key] = value;
  }

  return { year, origin: parseSide(row, 'coo'), asylum: parseSide(row, 'coa'), metrics };
}

function headline(dataset: DatasetId, metrics: Record<string, number>): number {
  switch (dataset) {
    case 'population':
      return POPULATION_HEADLINE.reduce((sum, key) => sum + (metrics[key] ?? 0), 0);
    case 'demographics':
      return metrics['total'] ?? 0;
    case 'asylum-applications':
      return metrics['applied'] ?? 0;
    case 'asylum-decisions':
      return metrics['dec_total'] ?? 0;
    default:
      // Datasets UNHCR does not serve never reach normalization with rows.
      return 0;
  }
}

/**
 * Normalize an array of raw UNHCR rows.
 *
 * The record's subject country is the country of asylum when present,
 * otherwise the country of origin (matching how the query was grouped).
 */
export function normalizeRows(
  items: readonly unknown[],
  dataset: DatasetId,
  fetchedAt: string,
): NormalizedRecord[] {
  const records: NormalizedRecord[] = [];
  for (const raw of items) {
    const parsed = parseRow(raw, dataset);
    if (!parsed) continue;

    const subject = parsed.asylum.name ? parsed.asylum : parsed.origin;
    const record: NormalizedRecord = {
      country: subject.name ?? 'All countries',
      country_code: subject.iso ?? '',
      year: parsed.year,
      population: headline(dataset, parsed.metrics),
      metrics: parsed.metrics,
      source: 'unhcr',
      last_updated: fetchedAt,
      dataset,
    };
    if (parsed.origin.name) {
      record.origin = parsed.origin.name;
      if (parsed.origin.iso) record.origin_code = parsed.origin.iso;
    }
    if (parsed.asylum.name) {
      record.asylum = parsed.asylum.name;
      if (parsed.asylum.iso) record.asylum_code = parsed.asylum.iso;
    }
    records.push(record);
  }
  return records;
}
