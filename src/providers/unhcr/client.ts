import type { HttpClient } from '../../shared/http.js';

/**
 * Thin, typed wrapper over the UNHCR Refugee Statistics API
 * (https://api.unhcr.org/population/v1). Knows URLs and query parameters —
 * nothing else. Field semantics live in normalize.ts; code translation in
 * codes.ts.
 */

export const UNHCR_BASE_URL = 'https://api.unhcr.org/population/v1';

/** Standard envelope every UNHCR endpoint returns. */
export interface UnhcrEnvelope<T> {
  page: number;
  maxPages: number;
  /** `[]` when absent, or an object of column totals. */
  total: unknown;
  items: T[];
}

export interface UnhcrCountryRaw {
  id: number;
  /** UNHCR's own 3-letter code — NOT always ISO3 (Egypt is "ARE", ISO "EGY"). */
  code: string;
  iso: string | null;
  iso2: string | null;
  name: string;
  nameShort?: string;
  nameLong?: string;
  nameFormal?: string;
  region?: string;
  majorArea?: string;
}

export type UnhcrDataEndpoint =
  'population' | 'demographics' | 'asylum-applications' | 'asylum-decisions' | 'solutions';

export interface UnhcrDataParams {
  /** UNHCR country code(s) of origin. */
  coo?: string;
  /** UNHCR country code(s) of asylum. */
  coa?: string;
  yearFrom?: number;
  yearTo?: number;
  /** Break rows down per country of origin. */
  coo_all?: boolean;
  /** Break rows down per country of asylum. */
  coa_all?: boolean;
  page?: number;
  limit?: number;
}

const COUNTRIES_TTL_SECONDS = 7 * 24 * 3600;

export class UnhcrClient {
  constructor(private readonly http: HttpClient) {}

  /** Full country reference list (cached for a week). */
  async countries(): Promise<UnhcrCountryRaw[]> {
    const url = `${UNHCR_BASE_URL}/countries/?limit=500`;
    const envelope = await this.http.getJson<UnhcrEnvelope<UnhcrCountryRaw>>(
      url,
      COUNTRIES_TTL_SECONDS,
    );
    return envelope.items;
  }

  /** Query one of the statistical endpoints. */
  data(endpoint: UnhcrDataEndpoint, params: UnhcrDataParams): Promise<UnhcrEnvelope<unknown>> {
    const search = new URLSearchParams();
    if (params.coo) search.set('coo', params.coo);
    if (params.coa) search.set('coa', params.coa);
    if (params.yearFrom !== undefined) search.set('yearFrom', String(params.yearFrom));
    if (params.yearTo !== undefined) search.set('yearTo', String(params.yearTo));
    if (params.coo_all) search.set('coo_all', 'true');
    if (params.coa_all) search.set('coa_all', 'true');
    search.set('page', String(params.page ?? 1));
    search.set('limit', String(params.limit ?? 100));

    const url = `${UNHCR_BASE_URL}/${endpoint}/?${search.toString()}`;
    return this.http.getJson<UnhcrEnvelope<unknown>>(url);
  }
}
