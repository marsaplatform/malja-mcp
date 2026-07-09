import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARABIC_COUNTRY_NAMES, arabicNamesFor } from '../../src/shared/country-names-ar.js';

interface RawCountry {
  iso?: unknown;
  name: string;
  code: string;
}

/** Same filter as the UNHCR provider: entries with a 3-letter ISO code. */
function realCountries(): { iso: string; name: string }[] {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '../fixtures/unhcr/countries.json'), 'utf8'),
  ) as { items: RawCountry[] };
  return raw.items
    .filter((c) => typeof c.iso === 'string' && c.iso.length === 3 && c.name !== c.code)
    .map((c) => ({ iso: c.iso as string, name: c.name }));
}

describe('ARABIC_COUNTRY_NAMES', () => {
  it('covers every country UNHCR serves (100%)', () => {
    const missing = realCountries().filter((c) => arabicNamesFor(c.iso).length === 0);
    expect(missing.map((c) => `${c.iso} ${c.name}`)).toEqual([]);
  });

  it('has no empty name lists or blank names', () => {
    for (const [iso3, names] of Object.entries(ARABIC_COUNTRY_NAMES)) {
      expect(names.length, iso3).toBeGreaterThan(0);
      for (const name of names) expect(name.trim(), iso3).not.toBe('');
    }
  });

  it('keys are ISO3-shaped', () => {
    for (const iso3 of Object.keys(ARABIC_COUNTRY_NAMES)) {
      expect(iso3).toMatch(/^[A-Z]{3}$/);
    }
  });
});
