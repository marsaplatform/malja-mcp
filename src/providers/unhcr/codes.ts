import { matchCountries } from '../../shared/country-match.js';
import { arabicNamesFor } from '../../shared/country-names-ar.js';
import type { CountryMatch, CountryRef } from '../types.js';
import type { UnhcrClient, UnhcrCountryRaw } from './client.js';

/**
 * UNHCR uses its own 3-letter country codes which differ from ISO3 for 99 of
 * 232 countries (Egypt is UNHCR "ARE" but ISO "EGY"; Algeria is "ALG"/"DZA").
 * This index hides that entirely: the rest of the codebase speaks ISO3 and
 * display names only.
 */

export interface UnhcrCountry extends CountryRef {
  /** UNHCR-internal code, used in coo/coa query params. */
  unhcrCode: string;
}

const EXTRA_ALIASES: Record<string, readonly string[]> = {
  COD: ['drc', 'democratic republic of the congo', 'congo kinshasa'],
  COG: ['congo brazzaville', 'republic of the congo'],
  GBR: ['uk', 'united kingdom', 'britain', 'great britain'],
  USA: ['us', 'usa', 'united states', 'america'],
  ARE: ['uae', 'emirates'],
  SYR: ['syria'],
  IRN: ['iran'],
  PRK: ['north korea'],
  KOR: ['south korea'],
  RUS: ['russia'],
  VEN: ['venezuela'],
  BOL: ['bolivia'],
  TZA: ['tanzania'],
  MDA: ['moldova'],
  LAO: ['laos'],
  VNM: ['vietnam'],
  CIV: ['ivory coast', "cote d'ivoire"],
  TUR: ['turkey', 'turkiye'],
  MMR: ['burma', 'myanmar'],
  CZE: ['czech republic', 'czechia'],
  MKD: ['macedonia', 'north macedonia'],
  PSE: ['palestine', 'west bank', 'gaza'],
};

export class CountryIndex {
  private byIso3 = new Map<string, UnhcrCountry>();
  private byUnhcrCode = new Map<string, UnhcrCountry>();
  private all: UnhcrCountry[] = [];
  private loaded: Promise<void> | undefined;

  constructor(private readonly client: UnhcrClient) {}

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.load().catch((err: unknown) => {
      // Allow a retry on the next call instead of caching the failure forever.
      this.loaded = undefined;
      throw err;
    });
    return this.loaded;
  }

  private async load(): Promise<void> {
    const raw = await this.client.countries();
    this.all = raw.filter(isRealCountry).map(toCountry);
    this.byIso3 = new Map(this.all.map((c) => [c.iso3, c]));
    this.byUnhcrCode = new Map(this.all.map((c) => [c.unhcrCode, c]));
  }

  /** Resolve an ISO3 code, UNHCR code or country name. Null when unknown. */
  async resolve(ref: string): Promise<UnhcrCountry | null> {
    await this.ensureLoaded();
    const upper = ref.trim().toUpperCase();
    const direct = this.byIso3.get(upper) ?? this.byUnhcrCode.get(upper);
    if (direct) return direct;
    const [best] = await this.search(ref, 1);
    return best && best.score >= 0.6 ? (this.byIso3.get(best.iso3) ?? null) : null;
  }

  /** Fuzzy search over names, codes and aliases. */
  async search(query: string, limit = 5): Promise<(CountryMatch & { unhcrCode: string })[]> {
    await this.ensureLoaded();
    const candidates = this.all.map((country) => ({
      value: country,
      names: [
        country.name,
        country.iso3,
        country.unhcrCode,
        ...(country.iso2 ? [country.iso2] : []),
        ...(EXTRA_ALIASES[country.iso3] ?? []),
        ...arabicNamesFor(country.iso3),
      ],
    }));
    return matchCountries(query, candidates, limit).map((m) => ({ ...m.value, score: m.score }));
  }

  /** All known countries (for metadata resources and completions). */
  async list(): Promise<UnhcrCountry[]> {
    await this.ensureLoaded();
    return [...this.all].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** ISO3 for a UNHCR code appearing in API rows (falls back to the code). */
  isoForUnhcrCode(code: string): string {
    return this.byUnhcrCode.get(code)?.iso3 ?? code;
  }
}

function isRealCountry(raw: UnhcrCountryRaw): boolean {
  // Entries without an ISO code are UNHCR statistical aggregates, not countries.
  return typeof raw.iso === 'string' && raw.iso.length === 3 && raw.name !== raw.code;
}

function toCountry(raw: UnhcrCountryRaw): UnhcrCountry {
  return {
    name: raw.name,
    iso3: raw.iso as string,
    ...(raw.iso2 ? { iso2: raw.iso2 } : {}),
    ...(raw.region ? { subregion: raw.region } : {}),
    ...(raw.majorArea ? { region: raw.majorArea } : {}),
    unhcrCode: raw.code,
  };
}
