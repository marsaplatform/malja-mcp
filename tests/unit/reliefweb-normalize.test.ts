import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeReports, toDocuments } from '../../src/providers/reliefweb/normalize.js';

/**
 * Fixtures were authored from the documented v2 envelope
 * (https://apidoc.reliefweb.int/) — live recording requires a pre-approved
 * appname. Re-record them against the real API once one is granted.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'reliefweb');

function fixture(name: string): { data: unknown[] } {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { data: unknown[] };
}

const NOW = '2026-01-01T00:00:00.000Z';

describe('normalizeReports', () => {
  const { data } = fixture('reports-sdn.json');
  const records = normalizeReports(data, NOW);

  it('emits one record per report so year aggregation yields counts', () => {
    // 5 fixture rows, 1 has no publication date at all → 4 records.
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record.population).toBe(1);
      expect(record.metrics).toEqual({ reports: 1 });
      expect(record.dataset).toBe('situation-reports');
      expect(record.source).toBe('reliefweb');
      expect(record.last_updated).toBe(NOW);
    }
  });

  it('takes the year from date.original and the primary country, uppercased', () => {
    const june2024 = records.find((r) => r.year === 2024)!;
    expect(june2024.country).toBe('Sudan');
    expect(june2024.country_code).toBe('SDN');
  });

  it('prefers the primary country even when it is not listed first', () => {
    const flashUpdate = records.filter((r) => r.year === 2023);
    expect(flashUpdate.some((r) => r.country_code === 'SDN')).toBe(true);
    expect(flashUpdate.some((r) => r.country_code === 'EGY')).toBe(false);
  });

  it('falls back to date.created and tolerates a missing country tag', () => {
    const regional = records.find((r) => r.country_code === '')!;
    expect(regional.year).toBe(2023);
  });

  it('drops rows without any usable date instead of guessing', () => {
    expect(records.some((r) => Number.isNaN(r.year))).toBe(false);
    // The no-date row appears in no record.
    expect(records).toHaveLength(4);
  });

  it('returns [] for hostile payloads', () => {
    expect(normalizeReports(undefined, NOW)).toEqual([]);
    expect(normalizeReports('garbage', NOW)).toEqual([]);
    expect(normalizeReports([null, 42, {}], NOW)).toEqual([]);
  });
});

describe('toDocuments', () => {
  const { data } = fixture('reports-sdn.json');
  const docs = toDocuments(data);

  it('keeps only rows with a title and a url', () => {
    // 5 fixture rows, 1 has no url → 4 documents.
    expect(docs).toHaveLength(4);
    expect(docs.every((d) => d.title.length > 0 && d.url.startsWith('https://'))).toBe(true);
  });

  it('joins source shortnames and carries date, country and format through', () => {
    const flashUpdate = docs.find((d) => d.title.includes('Flash Update'))!;
    expect(flashUpdate.source).toBe('IOM, DTM');
    expect(flashUpdate.date).toBe('2023-05-15T00:00:00+00:00');
    expect(flashUpdate.country_code).toBe('SDN');
    expect(flashUpdate.format).toBe('Situation Report');
  });

  it('degrades gracefully when source or date are missing', () => {
    const regional = docs.find((d) => d.title.includes('Regional overview'))!;
    expect(regional.source).toBe('');
    // No date.original → fall back to date.created.
    expect(regional.date).toBe('2023-11-02T00:00:00+00:00');

    const noDate = docs.find((d) => d.title.includes('no publication date'))!;
    expect(noDate.date).toBe('');
    expect(noDate.source).toBe('WFP');
  });

  it('returns [] for hostile payloads', () => {
    expect(toDocuments(undefined)).toEqual([]);
    expect(toDocuments({ not: 'an array' })).toEqual([]);
  });
});
