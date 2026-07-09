import type { HttpClient } from '../../shared/http.js';

/**
 * Thin, typed wrapper over the World Bank Indicators API v2
 * (https://api.worldbank.org/v2). Knows URLs, the [meta, rows] envelope and
 * its error shape — nothing else. Field semantics live in normalize.ts.
 * No API key required.
 */

export const WORLDBANK_BASE_URL = 'https://api.worldbank.org/v2';

/** Indicators served, mapped to the metric names records expose. */
export const WB_INDICATORS = {
  'SP.POP.TOTL': 'national_population',
  'NY.GDP.MKTP.CD': 'gdp_usd',
  'NY.GDP.PCAP.CD': 'gdp_per_capita_usd',
  'SI.POV.DDAY': 'poverty_rate_pct',
} as const;

export type WbIndicatorId = keyof typeof WB_INDICATORS;

export const ALL_WB_INDICATORS = Object.keys(WB_INDICATORS) as WbIndicatorId[];

export interface WbCountryRaw {
  /** ISO3 for real countries; WB also lists aggregates ("ARB" Arab World...). */
  id: string;
  iso2Code: string;
  name: string;
  /** Aggregates carry region.value === "Aggregates" — the provider filters them. */
  region?: { id: string; value: string };
}

export interface WbIndicatorRow {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  countryiso3code: string;
  /** Year as a string, e.g. "2023". */
  date: string;
  value: number | null;
}

const COUNTRIES_TTL_SECONDS = 7 * 24 * 3600;

/**
 * World Bank responses come as `[meta, rows]`; errors as a single-element
 * array whose head carries `message`. Rows may be `null` when empty.
 */
function extractRows<T>(payload: unknown): T[] {
  if (!Array.isArray(payload)) return [];
  if (payload.length < 2 || !Array.isArray(payload[1])) {
    const head = payload[0] as { message?: { value?: string }[] } | undefined;
    const message = head?.message?.[0]?.value;
    if (message) throw new Error(`World Bank API error: ${message}`);
    return [];
  }
  return payload[1] as T[];
}

export class WorldBankClient {
  constructor(private readonly http: HttpClient) {}

  /** Full reference list, aggregates included (cached for a week). */
  async countries(): Promise<WbCountryRaw[]> {
    const url = `${WORLDBANK_BASE_URL}/country?format=json&per_page=400`;
    const payload = await this.http.getJson<unknown[]>(url, COUNTRIES_TTL_SECONDS);
    return extractRows<WbCountryRaw>(payload);
  }

  /** One indicator for one ISO3 country (or "all"), over a year range. */
  async indicator(
    id: WbIndicatorId,
    country: string,
    yearFrom: number,
    yearTo: number,
  ): Promise<WbIndicatorRow[]> {
    const url =
      `${WORLDBANK_BASE_URL}/country/${encodeURIComponent(country.toLowerCase())}` +
      `/indicator/${id}?format=json&date=${yearFrom}:${yearTo}&per_page=20000`;
    const payload = await this.http.getJson<unknown[]>(url);
    return extractRows<WbIndicatorRow>(payload);
  }
}
