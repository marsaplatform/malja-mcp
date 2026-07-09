import { z } from 'zod';
import type { AppContext } from '../context.js';
import { fetchAllRows } from './common.js';

/**
 * Denominator support for `normalize_by`: turns absolute displacement figures
 * into per-capita / per-GDP rates using the `context-indicators` dataset
 * (World Bank provider). Lebanon and Germany host similar refugee numbers —
 * per 1,000 residents they are worlds apart; this is the module that says so.
 *
 * Denominators are matched per year (2015 refugees ÷ 2015 population), falling
 * back to the nearest observation within a small window; the year actually
 * used is always disclosed in tool output.
 */

export const NormalizeBySchema = z
  .enum(['population', 'gdp', 'none'])
  .describe(
    'Normalize values by a denominator: "population" → per 1,000 residents, "gdp" → per US$1bn GDP. Requires the worldbank provider.',
  );

export type NormalizeBy = z.infer<typeof NormalizeBySchema>;

/** People per 1,000 residents. */
export const PER_CAPITA_SCALE = 1_000;
/** People per US$ 1 billion of GDP. */
export const PER_GDP_SCALE = 1e9;

const DENOMINATOR_METRIC = {
  population: 'national_population',
  gdp: 'gdp_usd',
} as const;

/** How far (in years) a denominator observation may sit from the data year. */
const MAX_DENOMINATOR_LAG_YEARS = 4;

interface Observation {
  year: number;
  value: number;
}

export interface DenominatorSet {
  kind: 'population' | 'gdp';
  metric: string;
  /** Human unit for normalized values, e.g. "per 1,000 residents". */
  unit: string;
  scale: number;
  /** Observations per ISO3, sorted by year ascending. */
  series: Map<string, Observation[]>;
  source: string;
  citation: string;
}

/**
 * Fetch denominator observations covering `yearFrom..yearTo`. Pass `iso3s`
 * for a handful of countries (one cached fetch each); omit it to pull every
 * country in one grouped call (rankings). Throws an actionable error when
 * no enabled provider serves context-indicators.
 */
export async function fetchDenominators(
  ctx: AppContext,
  kind: 'population' | 'gdp',
  range: { yearFrom: number; yearTo: number },
  iso3s?: readonly string[],
): Promise<DenominatorSet> {
  const metric = DENOMINATOR_METRIC[kind];
  let provider;
  try {
    provider = await ctx.registry.forDataset('context-indicators');
  } catch {
    throw new Error(
      'normalize_by needs the "context-indicators" dataset. Enable the World Bank provider: HMCP_PROVIDERS=unhcr,worldbank',
    );
  }
  const meta = await provider.metadata();
  const citation = meta.datasets.find((d) => d.id === 'context-indicators')?.citation ?? meta.name;

  const queries =
    iso3s && iso3s.length > 0
      ? iso3s.map((iso3) => ({ asylum_iso3: iso3 }))
      : [{ groupBy: 'asylum' as const }];

  const series = new Map<string, Observation[]>();
  for (const filter of queries) {
    const { records } = await fetchAllRows(ctx, {
      dataset: 'context-indicators',
      yearFrom: range.yearFrom - MAX_DENOMINATOR_LAG_YEARS,
      yearTo: range.yearTo,
      ...filter,
    });
    for (const record of records) {
      const value = record.metrics[metric];
      if (value === undefined || value <= 0) continue;
      const observations = series.get(record.country_code) ?? [];
      observations.push({ year: record.year, value });
      series.set(record.country_code, observations);
    }
  }
  for (const observations of series.values()) {
    observations.sort((a, b) => a.year - b.year);
  }

  return {
    kind,
    metric,
    unit: kind === 'population' ? 'per 1,000 residents' : 'per US$1bn GDP',
    scale: kind === 'population' ? PER_CAPITA_SCALE : PER_GDP_SCALE,
    series,
    source: provider.id,
    citation,
  };
}

/**
 * The denominator observation for a country-year: the latest at or before
 * `year`, else the earliest after it — null when nothing sits within the
 * lag window.
 */
export function denominatorFor(
  set: DenominatorSet,
  iso3: string,
  year: number,
): Observation | null {
  const observations = set.series.get(iso3);
  if (!observations || observations.length === 0) return null;
  let best: Observation | undefined;
  for (const observation of observations) {
    if (observation.year <= year) best = observation;
    else break;
  }
  best ??= observations[0];
  if (!best || Math.abs(best.year - year) > MAX_DENOMINATOR_LAG_YEARS) return null;
  return best;
}

export interface NormalizedValue {
  value: number;
  denominator_year: number;
}

/** `value` normalized for a country-year; null when no denominator matches. */
export function normalizeValue(
  set: DenominatorSet,
  iso3: string,
  year: number,
  value: number,
): NormalizedValue | null {
  const denominator = denominatorFor(set, iso3, year);
  if (!denominator) return null;
  return {
    value: (value / denominator.value) * set.scale,
    denominator_year: denominator.year,
  };
}
