import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeRows, toNumber } from '../../src/providers/unhcr/normalize.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');

function fixture(name: string): { items: unknown[] } {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { items: unknown[] };
}

const NOW = '2026-01-01T00:00:00.000Z';

describe('toNumber', () => {
  it('passes finite numbers through', () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
  });

  it('parses numeric strings (UNHCR sends "0" as a string)', () => {
    expect(toNumber('0')).toBe(0);
    expect(toNumber('12345')).toBe(12345);
  });

  it('treats "-" and garbage as missing', () => {
    expect(toNumber('-')).toBeUndefined();
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('n/a')).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber(Infinity)).toBeUndefined();
  });
});

describe('normalizeRows — population', () => {
  it('normalizes a real Egypt (country of asylum) row', () => {
    const { items } = fixture('population-egypt-2023.json');
    const records = normalizeRows(items, 'population', NOW);

    expect(records).toHaveLength(1);
    const record = records[0]!;
    // The subject is the asylum side; codes are ISO3, not UNHCR-internal.
    expect(record.country).toBe('Egypt');
    expect(record.country_code).toBe('EGY');
    expect(record.asylum_code).toBe('EGY');
    expect(record.origin).toBeUndefined();
    expect(record.year).toBe(2023);
    expect(record.metrics['refugees']).toBe(240507);
    expect(record.metrics['asylum_seekers']).toBe(232244);
    // "-" cells (oip) are omitted rather than zeroed.
    expect(record.metrics['oip']).toBeUndefined();
    // String "0" cells are real zeros.
    expect(record.metrics['idps']).toBe(0);
    // Headline = refugees + asylum_seekers + idps + stateless + ooc + oip.
    expect(record.population).toBe(240507 + 232244 + 0 + 10 + 0);
    expect(record.dataset).toBe('population');
    expect(record.source).toBe('unhcr');
    expect(record.last_updated).toBe(NOW);
  });

  it('normalizes a Syria (country of origin) aggregate row', () => {
    const { items } = fixture('population-syria-origin-2023.json');
    const records = normalizeRows(items, 'population', NOW);

    expect(records).toHaveLength(1);
    const record = records[0]!;
    // No asylum side → subject falls back to the origin country.
    expect(record.country).toBe('Syrian Arab Rep.');
    expect(record.country_code).toBe('SYR');
    expect(record.origin_code).toBe('SYR');
    expect(record.asylum).toBeUndefined();
    expect(record.metrics['refugees']).toBe(6355788);
    expect(record.metrics['idps']).toBe(7248188);
  });

  it('skips rows without a parseable year', () => {
    const records = normalizeRows([{ year: '-' }, { bogus: true }, null], 'population', NOW);
    expect(records).toHaveLength(0);
  });
});

describe('normalizeRows — other datasets', () => {
  it('normalizes demographics with age/sex buckets', () => {
    const { items } = fixture('demographics-egypt-latest.json');
    const [record] = normalizeRows(items, 'demographics', NOW);
    expect(record!.metrics['f_total']).toBe(595655);
    expect(record!.metrics['m_total']).toBe(502651);
    expect(record!.population).toBe(1098306);
  });

  it('normalizes asylum applications (headline = applied)', () => {
    const { items } = fixture('asylum-applications-egypt-2023.json');
    const records = normalizeRows(items, 'asylum-applications', NOW);
    expect(records).toHaveLength(2);
    expect(records[0]!.population).toBe(183051);
  });

  it('normalizes asylum decisions (headline = dec_total)', () => {
    const { items } = fixture('asylum-decisions-egypt-2023.json');
    const records = normalizeRows(items, 'asylum-decisions', NOW);
    expect(records).toHaveLength(2);
    expect(records[0]!.metrics['dec_recognized']).toBe(9419);
    expect(records[0]!.population).toBe(14800);
  });
});

describe('normalizeRows — solutions', () => {
  it('keeps "-" cells absent and sums reported flows into the headline', () => {
    const records = normalizeRows(
      [
        {
          year: 2023,
          coo_name: 'Syrian Arab Rep.',
          coo_iso: 'SYR',
          coa_name: 'Lebanon',
          coa_iso: 'LBN',
          returned_refugees: 10130,
          resettlement: '-',
          naturalisation: '-',
          returned_idps: '-',
        },
      ],
      'solutions',
      '2026-10-20T00:00:00.000Z',
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      country_code: 'LBN',
      origin_code: 'SYR',
      population: 10130,
      metrics: { returned_refugees: 10130 },
      dataset: 'solutions',
    });
  });
});
