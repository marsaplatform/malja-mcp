import { describe, expect, it } from 'vitest';
import { matchCountries, normalizeName } from '../../src/shared/country-match.js';

describe('normalizeName', () => {
  it('lowercases, strips diacritics and punctuation', () => {
    expect(normalizeName('Türkiye')).toBe('turkiye');
    expect(normalizeName("Cote d'Ivoire")).toBe('cote d ivoire');
    expect(normalizeName('  Syrian   Arab Rep. ')).toBe('syrian arab rep');
  });

  it('folds Arabic spelling variants onto one form', () => {
    // Definite article + hamza forms: الأردن / الاردن / اردن are the same country.
    expect(normalizeName('الأردن')).toBe(normalizeName('الاردن'));
    expect(normalizeName('الأردن')).toBe(normalizeName('اردن'));
    // Taa marbuta vs taa/ha: سورية folds with سوريه.
    expect(normalizeName('سورية')).toBe(normalizeName('سوريه'));
    // Alef maqsura and harakat.
    expect(normalizeName('مِصْر')).toBe(normalizeName('مصر'));
    expect(normalizeName('عُمان')).toBe(normalizeName('عمان'));
    // Arabic letters must survive normalization (not be stripped as punctuation).
    expect(normalizeName('مصر')).not.toBe('');
  });
});

describe('matchCountries', () => {
  const candidates = [
    { value: 'EGY', names: ['Egypt', 'EGY', 'EG'] },
    { value: 'SYR', names: ['Syrian Arab Rep.', 'SYR', 'syria'] },
    { value: 'ARE', names: ['United Arab Emirates', 'ARE', 'uae'] },
  ];

  it('ranks exact matches first', () => {
    const [best] = matchCountries('egypt', candidates);
    expect(best).toEqual({ value: 'EGY', score: 1 });
  });

  it('finds aliases and codes', () => {
    expect(matchCountries('syria', candidates)[0]!.value).toBe('SYR');
    expect(matchCountries('SYR', candidates)[0]!.value).toBe('SYR');
    expect(matchCountries('uae', candidates)[0]!.value).toBe('ARE');
  });

  it('scores prefix above substring, and drops non-matches', () => {
    const results = matchCountries('egy', candidates);
    expect(results[0]!.value).toBe('EGY');
    expect(results.find((r) => r.value === 'ARE')).toBeUndefined();
  });

  it('matches multi-token queries by overlap', () => {
    expect(matchCountries('arab emirates', candidates)[0]!.value).toBe('ARE');
  });

  it('returns nothing for empty or unmatched queries', () => {
    expect(matchCountries('', candidates)).toEqual([]);
    expect(matchCountries('wakanda', candidates)).toEqual([]);
  });

  it('matches Arabic names and their spelling variants', () => {
    const arabicCandidates = [
      { value: 'EGY', names: ['Egypt', 'EGY', 'مصر'] },
      { value: 'SYR', names: ['Syrian Arab Rep.', 'SYR', 'سوريا', 'سورية'] },
      { value: 'JOR', names: ['Jordan', 'JOR', 'الأردن'] },
    ];
    expect(matchCountries('مصر', arabicCandidates)[0]).toEqual({ value: 'EGY', score: 1 });
    expect(matchCountries('سوريا', arabicCandidates)[0]!.value).toBe('SYR');
    expect(matchCountries('سورية', arabicCandidates)[0]!.value).toBe('SYR');
    expect(matchCountries('الاردن', arabicCandidates)[0]).toEqual({ value: 'JOR', score: 1 });
    expect(matchCountries('اردن', arabicCandidates)[0]).toEqual({ value: 'JOR', score: 1 });
  });
});
