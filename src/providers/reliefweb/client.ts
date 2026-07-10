import type { HttpClient } from '../../shared/http.js';

/**
 * Typed wrapper over the ReliefWeb v2 REST endpoints — URLs and params only.
 *
 * v1 was decommissioned; v2 keeps the same envelope and parameter encoding
 * (https://apidoc.reliefweb.int/). Since 1 November 2025 every request needs
 * a pre-approved `appname`, requested via a short form reviewed by ReliefWeb.
 */

export const RELIEFWEB_BASE_URL = 'https://api.reliefweb.int/v2';
export const RELIEFWEB_APPNAME_DOCS = 'https://apidoc.reliefweb.int/parameters#appname';

/** ReliefWeb curates situation reports under this format tag. */
const FORMAT_SITUATION_REPORT = 'Situation Report';

const REPORT_FIELDS = [
  'title',
  'url',
  'date.original',
  'date.created',
  'source.name',
  'source.shortname',
  'country.iso3',
  'country.name',
  'country.primary',
  'format.name',
];

export interface RwCountryRaw {
  name?: string;
  shortname?: string;
  iso3?: string;
}

export interface RwListResponse {
  totalCount?: number;
  count?: number;
  data?: unknown[];
}

export interface ReportsQuery {
  iso3?: string;
  query?: string;
  yearFrom?: number;
  yearTo?: number;
  limit: number;
  offset: number;
}

export class ReliefWebClient {
  constructor(
    private readonly http: HttpClient,
    private readonly appname: string,
  ) {}

  async countries(): Promise<RwCountryRaw[]> {
    const params = new URLSearchParams({ appname: this.appname, limit: '1000' });
    for (const field of ['name', 'shortname', 'iso3']) {
      params.append('fields[include][]', field);
    }
    const response = await this.http.getJson<RwListResponse>(
      `${RELIEFWEB_BASE_URL}/countries?${params.toString()}`,
    );
    return (response.data ?? []).map((row) => (row as { fields?: RwCountryRaw }).fields ?? {});
  }

  /** Situation reports, newest first, with AND-combined filter conditions. */
  reports(query: ReportsQuery): Promise<RwListResponse> {
    const params = new URLSearchParams({ appname: this.appname });
    params.set('limit', String(query.limit));
    params.set('offset', String(query.offset));
    for (const field of REPORT_FIELDS) params.append('fields[include][]', field);
    params.append('sort[]', 'date.original:desc');
    if (query.query) params.set('query[value]', query.query);

    params.set('filter[operator]', 'AND');
    let index = 0;
    const condition = (field: string, value: string): void => {
      params.set(`filter[conditions][${index}][field]`, field);
      params.set(`filter[conditions][${index}][value]`, value);
      index += 1;
    };
    condition('format.name', FORMAT_SITUATION_REPORT);
    if (query.iso3) condition('country.iso3', query.iso3.toLowerCase());
    if (query.yearFrom !== undefined || query.yearTo !== undefined) {
      params.set(`filter[conditions][${index}][field]`, 'date.original');
      params.set(
        `filter[conditions][${index}][value][from]`,
        `${query.yearFrom ?? 1900}-01-01T00:00:00+00:00`,
      );
      params.set(
        `filter[conditions][${index}][value][to]`,
        `${query.yearTo ?? 2200}-12-31T23:59:59+00:00`,
      );
      index += 1;
    }

    return this.http.getJson<RwListResponse>(`${RELIEFWEB_BASE_URL}/reports?${params.toString()}`);
  }

  /** Cheapest liveness probe the API allows. */
  probe(): Promise<RwListResponse> {
    const params = new URLSearchParams({ appname: this.appname, limit: '1' });
    return this.http.getJson<RwListResponse>(`${RELIEFWEB_BASE_URL}/reports?${params.toString()}`);
  }
}
