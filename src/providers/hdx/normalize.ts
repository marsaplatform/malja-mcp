import type { NormalizedRecord } from '../types.js';
import type {
  HapiConflictRow,
  HapiFoodSecurityRow,
  HapiFundingRow,
  HapiIdpsRow,
  HdxTheme,
} from './client.js';

/**
 * Raw HAPI rows → normalized records. Pure.
 *
 * Each theme has its own aggregation semantics — encoded here once:
 *  - idps: stock figures; the latest reference period per country-year wins
 *    (summing assessment rounds would double-count people).
 *  - conflict-events: flows; monthly/event-type rows sum into country-year
 *    totals of events and fatalities.
 *  - humanitarian-funding: appeals sum per country-year; coverage percentage
 *    is recomputed after summing (averaging percentages would be wrong).
 *  - food-security: IPC phases pivot into one record per country-year, with
 *    "phase 3+" (crisis or worse) as the headline figure; current-type
 *    analyses are preferred over projections.
 */

const SOURCE_CITATIONS: Record<HdxTheme, string> = {
  idps: 'IOM DTM via HDX HAPI, https://data.humdata.org/',
  'conflict-events': 'ACLED via HDX HAPI, https://data.humdata.org/',
  'humanitarian-funding': 'OCHA FTS via HDX HAPI, https://data.humdata.org/',
  'food-security': 'IPC via HDX HAPI, https://data.humdata.org/',
};

export function citationFor(theme: HdxTheme): string {
  return SOURCE_CITATIONS[theme];
}

function yearOf(isoDate: string | undefined | null): number | undefined {
  if (!isoDate) return undefined;
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

function baseRecord(
  row: { location_code: string; location_name: string },
  year: number,
  dataset: HdxTheme,
  fetchedAt: string,
): NormalizedRecord {
  return {
    country: row.location_name,
    country_code: row.location_code.toUpperCase(),
    year,
    population: 0,
    metrics: {},
    source: 'hdx',
    last_updated: fetchedAt,
    dataset,
  };
}

function normalizeIdps(rows: HapiIdpsRow[], fetchedAt: string): NormalizedRecord[] {
  // Latest reference period per country-year wins — stocks, not flows.
  const latest = new Map<string, { periodStart: string; row: HapiIdpsRow; year: number }>();
  for (const row of rows) {
    const year = yearOf(row.reference_period_start);
    if (year === undefined || typeof row.population !== 'number') continue;
    const key = `${row.location_code}:${year}`;
    const existing = latest.get(key);
    if (!existing || row.reference_period_start > existing.periodStart) {
      latest.set(key, { periodStart: row.reference_period_start, row, year });
    }
  }
  return [...latest.values()].map(({ row, year }) => {
    const record = baseRecord(row, year, 'idps', fetchedAt);
    record.metrics['idps'] = row.population;
    record.population = row.population;
    return record;
  });
}

function normalizeConflict(rows: HapiConflictRow[], fetchedAt: string): NormalizedRecord[] {
  const byKey = new Map<string, NormalizedRecord>();
  for (const row of rows) {
    const year = yearOf(row.reference_period_start);
    if (year === undefined) continue;
    const key = `${row.location_code}:${year}`;
    const record = byKey.get(key) ?? baseRecord(row, year, 'conflict-events', fetchedAt);
    record.metrics['events'] = (record.metrics['events'] ?? 0) + (row.events ?? 0);
    record.metrics['fatalities'] = (record.metrics['fatalities'] ?? 0) + (row.fatalities ?? 0);
    record.population = record.metrics['events'];
    byKey.set(key, record);
  }
  return [...byKey.values()];
}

function normalizeFunding(rows: HapiFundingRow[], fetchedAt: string): NormalizedRecord[] {
  const byKey = new Map<string, NormalizedRecord>();
  for (const row of rows) {
    const year = yearOf(row.reference_period_start);
    if (year === undefined) continue;
    const key = `${row.location_code}:${year}`;
    const record = byKey.get(key) ?? baseRecord(row, year, 'humanitarian-funding', fetchedAt);
    record.metrics['requirements_usd'] =
      (record.metrics['requirements_usd'] ?? 0) + (row.requirements_usd ?? 0);
    record.metrics['funding_usd'] = (record.metrics['funding_usd'] ?? 0) + (row.funding_usd ?? 0);
    byKey.set(key, record);
  }
  for (const record of byKey.values()) {
    const requirements = record.metrics['requirements_usd'] ?? 0;
    const funding = record.metrics['funding_usd'] ?? 0;
    if (requirements > 0) {
      record.metrics['funding_coverage_pct'] = Number(((funding / requirements) * 100).toFixed(1));
    }
    record.population = funding;
  }
  return [...byKey.values()];
}

const PHASE_METRIC: Record<string, string> = {
  '1': 'ipc_phase_1',
  '2': 'ipc_phase_2',
  '3': 'ipc_phase_3',
  '4': 'ipc_phase_4',
  '5': 'ipc_phase_5',
  '3+': 'ipc_phase_3plus',
  all: 'analyzed_population',
};

function normalizeFoodSecurity(rows: HapiFoodSecurityRow[], fetchedAt: string): NormalizedRecord[] {
  // Prefer current analyses over projections when both exist.
  const current = rows.filter((r) => !r.ipc_type || /current/i.test(r.ipc_type));
  const usable = current.length > 0 ? current : rows;

  // Keep only the latest reference period per country-year, then pivot phases.
  const latestPeriod = new Map<string, string>();
  for (const row of usable) {
    const year = yearOf(row.reference_period_start);
    if (year === undefined) continue;
    const key = `${row.location_code}:${year}`;
    const existing = latestPeriod.get(key);
    if (!existing || row.reference_period_start > existing) {
      latestPeriod.set(key, row.reference_period_start);
    }
  }

  const byKey = new Map<string, NormalizedRecord>();
  for (const row of usable) {
    const year = yearOf(row.reference_period_start);
    if (year === undefined || typeof row.population_in_phase !== 'number') continue;
    const key = `${row.location_code}:${year}`;
    if (latestPeriod.get(key) !== row.reference_period_start) continue;
    const metric = PHASE_METRIC[row.ipc_phase];
    if (!metric) continue;
    const record = byKey.get(key) ?? baseRecord(row, year, 'food-security', fetchedAt);
    record.metrics[metric] = (record.metrics[metric] ?? 0) + row.population_in_phase;
    byKey.set(key, record);
  }
  for (const record of byKey.values()) {
    // Headline: people in crisis or worse (IPC 3+), reconstructed if absent.
    record.population =
      record.metrics['ipc_phase_3plus'] ??
      (record.metrics['ipc_phase_3'] ?? 0) +
        (record.metrics['ipc_phase_4'] ?? 0) +
        (record.metrics['ipc_phase_5'] ?? 0);
  }
  return [...byKey.values()];
}

/** Dispatch normalization per theme; unknown payload shapes yield []. */
export function normalizeTheme(
  theme: HdxTheme,
  raw: unknown,
  fetchedAt: string,
): NormalizedRecord[] {
  if (!Array.isArray(raw)) return [];
  switch (theme) {
    case 'idps':
      return normalizeIdps(raw as HapiIdpsRow[], fetchedAt);
    case 'conflict-events':
      return normalizeConflict(raw as HapiConflictRow[], fetchedAt);
    case 'humanitarian-funding':
      return normalizeFunding(raw as HapiFundingRow[], fetchedAt);
    case 'food-security':
      return normalizeFoodSecurity(raw as HapiFoodSecurityRow[], fetchedAt);
  }
}
