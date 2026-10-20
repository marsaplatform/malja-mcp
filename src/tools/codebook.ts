import { translator } from '../i18n/index.js';
import type { Translator } from '../i18n/index.js';
import type { DatasetId } from '../providers/types.js';

/**
 * Variable-level documentation for exports: what each column means, its unit
 * and how derived values are computed. This is the codebook a paper's data
 * appendix needs — generated to match exactly the columns of the export it
 * accompanies, never a generic glossary dump.
 *
 * Descriptions keep Western digits in every locale (they cite indicator
 * codes and standards). Wording lives in the i18n message catalogs (`codebook.fields`,
 * `codebook.units`, `codebook.headline`); this module only decides which
 * variables apply to which dataset. Field names are never translated.
 */

export interface CodebookEntry {
  field: string;
  description: string;
  unit: string;
}

/** [field, description key, unit key] — keys resolve in the message catalog. */
type Spec = readonly [field: string, descriptionKey: string, unit: string];

const BASE_FIELDS: Spec[] = [
  ['country', 'country', 'text'],
  ['country_code', 'country_code', 'ISO3'],
  ['origin', 'origin', 'text'],
  ['origin_code', 'origin_code', 'ISO3'],
  ['asylum', 'asylum', 'text'],
  ['asylum_code', 'asylum_code', 'ISO3'],
  ['year', 'year', 'year'],
  ['source', 'source', 'id'],
  ['last_updated', 'last_updated', 'ISO timestamp'],
  ['dataset', 'dataset', 'id'],
];

const same = (field: string, unit: string): Spec => [field, field, unit];

const METRIC_FIELDS: Partial<Record<DatasetId, Spec[]>> = {
  population: [
    same('refugees', 'persons'),
    same('asylum_seekers', 'persons'),
    same('returned_refugees', 'persons'),
    same('idps', 'persons'),
    same('returned_idps', 'persons'),
    same('stateless', 'persons'),
    same('ooc', 'persons'),
    same('oip', 'persons'),
    same('hst', 'persons'),
  ],
  'asylum-applications': [same('applied', 'applications')],
  'asylum-decisions': [
    same('dec_recognized', 'decisions'),
    same('dec_other', 'decisions'),
    same('dec_rejected', 'decisions'),
    same('dec_closed', 'decisions'),
    same('dec_total', 'decisions'),
  ],
  solutions: [
    same('returned_refugees', 'persons'),
    same('resettlement', 'persons'),
    same('naturalisation', 'persons'),
    same('returned_idps', 'persons'),
  ],
  'context-indicators': [
    same('national_population', 'persons'),
    same('gdp_usd', 'current US$'),
    same('gdp_per_capita_usd', 'current US$'),
    same('poverty_rate_pct', '% of population'),
  ],
  idps: [['idps', 'idps_hdx', 'persons']],
  'conflict-events': [same('events', 'events'), same('fatalities', 'persons')],
  'humanitarian-funding': [
    same('requirements_usd', 'current US$'),
    same('funding_usd', 'current US$'),
    same('funding_coverage_pct', '%'),
  ],
  'food-security': [
    same('ipc_phase_1', 'persons'),
    same('ipc_phase_2', 'persons'),
    same('ipc_phase_3', 'persons'),
    same('ipc_phase_4', 'persons'),
    same('ipc_phase_5', 'persons'),
    same('ipc_phase_3plus', 'persons'),
    same('analyzed_population', 'persons'),
  ],
  'situation-reports': [same('reports', 'reports')],
};

const DEMOGRAPHIC_BUCKETS = ['0_4', '5_11', '12_17', '18_59', '60', 'other', 'total'] as const;

/** Demographics buckets are generated (f_/m_ × age ranges) — build on demand. */
function demographicEntries(tr: Translator): CodebookEntry[] {
  const m = tr.m;
  return (['f', 'm'] as const).flatMap((sex) =>
    DEMOGRAPHIC_BUCKETS.map((bucket) => ({
      field: `${sex}_${bucket}`,
      description: m.codebook.demographic(
        sex === 'f' ? m.demographics.female : m.demographics.male,
        m.demographics.age[bucket] ?? bucket,
      ),
      unit: m.codebook.units['persons'] ?? 'persons',
    })),
  );
}

function entry(tr: Translator, [field, key, unit]: Spec): CodebookEntry {
  return {
    field,
    // Technical documentation: digits stay Western (indicator codes, $2.15, ISO 3166-1).
    description: tr.m.codebook.fields[key] ?? key,
    unit: tr.m.codebook.units[unit] ?? unit,
  };
}

/**
 * Codebook rows for a dataset, restricted to fields actually present in the
 * export so it documents exactly what the reader holds.
 */
export function buildCodebook(
  dataset: DatasetId,
  presentFields: readonly string[],
  tr: Translator = translator('en'),
): CodebookEntry[] {
  const m = tr.m;
  const metricEntries =
    dataset === 'demographics'
      ? [...demographicEntries(tr), entry(tr, ['total', 'demographics_total', 'persons'])]
      : (METRIC_FIELDS[dataset] ?? []).map((spec) => entry(tr, spec));
  const population: CodebookEntry = {
    field: 'population',
    description: m.codebook.headlinePrefix(
      m.codebook.headline[dataset] ?? m.codebook.headlineFallback,
    ),
    unit: m.codebook.units['persons'] ?? 'persons',
  };
  const all = [...BASE_FIELDS.map((spec) => entry(tr, spec)), population, ...metricEntries];
  const present = new Set(presentFields);
  return all.filter((e) => present.has(e.field));
}

/** Codebook as a markdown table (for tool text output and appendices). */
export function codebookMarkdown(
  entries: readonly CodebookEntry[],
  tr: Translator = translator('en'),
): string {
  return tr.table(
    tr.m.codebook.headers,
    entries.map((e) => [e.field, e.description, e.unit]),
  );
}
