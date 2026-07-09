import type { NormalizedRecord } from '../types.js';
import { WB_INDICATORS } from './client.js';
import type { WbIndicatorRow } from './client.js';

/**
 * Raw World Bank indicator rows → normalized records. Pure.
 *
 * The API returns one row per indicator-country-year; this merges them into
 * one record per country-year with every available metric. Null cells (no
 * observation published) are skipped rather than emitted as zero — a missing
 * denominator must stay missing.
 */
export function normalizeIndicatorRows(
  rows: readonly WbIndicatorRow[],
  fetchedAt: string,
): NormalizedRecord[] {
  const byKey = new Map<string, NormalizedRecord>();

  for (const row of rows) {
    const iso3 = row.countryiso3code?.toUpperCase();
    const year = Number.parseInt(row.date, 10);
    const metric = WB_INDICATORS[row.indicator?.id as keyof typeof WB_INDICATORS];
    if (!iso3 || iso3.length !== 3 || !Number.isFinite(year) || !metric) continue;
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) continue;

    const key = `${iso3}:${year}`;
    const record = byKey.get(key) ?? {
      country: row.country?.value ?? iso3,
      country_code: iso3,
      year,
      population: 0,
      metrics: {},
      source: 'worldbank',
      last_updated: fetchedAt,
      dataset: 'context-indicators' as const,
    };
    record.metrics[metric] = row.value;
    // The headline figure for this dataset is the national population.
    if (metric === 'national_population') record.population = row.value;
    byKey.set(key, record);
  }

  return [...byKey.values()].sort((a, b) =>
    a.country_code === b.country_code
      ? a.year - b.year
      : a.country_code.localeCompare(b.country_code),
  );
}
