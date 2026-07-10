import type { DocumentItem, NormalizedRecord } from '../types.js';

/**
 * Pure normalization of ReliefWeb `/reports` rows.
 *
 * Each report becomes one record with `population = 1` and
 * `metrics.reports = 1`, so the platform's per-year aggregation
 * (`aggregateByYear`) turns rows into report counts without any
 * ReliefWeb-specific logic leaking outside this directory.
 */

interface RwEntity {
  name?: string;
  shortname?: string;
  iso3?: string;
  primary?: boolean;
}

interface RwReportFields {
  title?: string;
  url?: string;
  date?: { original?: string; created?: string };
  source?: RwEntity[];
  country?: RwEntity[];
  format?: { name?: string }[];
}

function fieldsOf(row: unknown): RwReportFields | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const fields = (row as { fields?: unknown }).fields;
  if (typeof fields !== 'object' || fields === null) return undefined;
  return fields as RwReportFields;
}

/** The country a report is about: the `primary`-flagged one, else the first. */
function primaryCountry(fields: RwReportFields): RwEntity | undefined {
  if (!Array.isArray(fields.country)) return undefined;
  return fields.country.find((c) => c?.primary === true) ?? fields.country[0];
}

/** Publication date: `date.original`, falling back to `date.created`. */
function publicationDate(fields: RwReportFields): string {
  const date = fields.date;
  if (typeof date !== 'object' || date === null) return '';
  if (typeof date.original === 'string' && date.original.length > 0) return date.original;
  if (typeof date.created === 'string' && date.created.length > 0) return date.created;
  return '';
}

function yearOf(isoDate: string): number | undefined {
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : undefined;
}

export function normalizeReports(data: unknown, now: string): NormalizedRecord[] {
  if (!Array.isArray(data)) return [];
  const records: NormalizedRecord[] = [];

  for (const row of data) {
    const fields = fieldsOf(row);
    if (!fields) continue;
    const year = yearOf(publicationDate(fields));
    if (year === undefined) continue; // no usable date — never guess

    const country = primaryCountry(fields);
    records.push({
      country: country?.name ?? '',
      country_code: country?.iso3?.toUpperCase() ?? '',
      year,
      population: 1,
      metrics: { reports: 1 },
      source: 'reliefweb',
      last_updated: now,
      dataset: 'situation-reports',
    });
  }
  return records;
}

export function toDocuments(data: unknown): DocumentItem[] {
  if (!Array.isArray(data)) return [];
  const docs: DocumentItem[] = [];

  for (const row of data) {
    const fields = fieldsOf(row);
    if (!fields) continue;
    if (typeof fields.title !== 'string' || fields.title.length === 0) continue;
    if (typeof fields.url !== 'string' || fields.url.length === 0) continue;

    const country = primaryCountry(fields);
    const sources = Array.isArray(fields.source)
      ? fields.source
          .map((s) => s?.shortname ?? s?.name ?? '')
          .filter((s) => s.length > 0)
          .join(', ')
      : '';
    const format = Array.isArray(fields.format) ? fields.format[0]?.name : undefined;

    docs.push({
      title: fields.title,
      url: fields.url,
      source: sources,
      date: publicationDate(fields),
      ...(country?.iso3 ? { country_code: country.iso3.toUpperCase() } : {}),
      ...(format ? { format } : {}),
    });
  }
  return docs;
}
