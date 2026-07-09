import type { HttpClient } from '../../shared/http.js';

/**
 * Thin, typed wrapper over HDX HAPI (https://hapi.humdata.org) — the
 * normalized API over the Humanitarian Data Exchange. Knows URLs, the
 * `{data: [...]}` envelope and the app-identifier requirement; field
 * semantics live in normalize.ts.
 *
 * HAPI is in beta: every endpoint path lives in THEME_PATHS below and
 * nowhere else, so an upstream rename is a one-line fix.
 */

export const HAPI_BASE_URL = 'https://hapi.humdata.org/api/v2';

/**
 * Datasets this provider serves, mapped to HAPI endpoint paths and the admin
 * level that actually carries data (verified against the live API and its
 * OpenAPI spec, 2026-07-10):
 *  - idps / food-security publish national rows (admin 0);
 *  - conflict-events (ACLED) exists ONLY at admin 2, monthly per event type —
 *    requesting admin 0 returns nothing; normalize.ts sums the district rows
 *    into country-years;
 *  - funding is national appeals and accepts no admin_level parameter at all.
 */
export const THEME_CONFIG = {
  idps: { path: 'affected-people/idps', adminLevel: 0 },
  'conflict-events': { path: 'coordination-context/conflict-events', adminLevel: 2 },
  'humanitarian-funding': { path: 'coordination-context/funding', adminLevel: undefined },
  'food-security': { path: 'food-security-nutrition-poverty/food-security', adminLevel: 0 },
} as const;

export type HdxTheme = keyof typeof THEME_CONFIG;

export const ALL_HDX_THEMES = Object.keys(THEME_CONFIG) as HdxTheme[];

/** Fields shared by every HAPI row this provider consumes. */
export interface HapiRowBase {
  location_code: string;
  location_name: string;
  reference_period_start: string;
  reference_period_end?: string | null;
}

export interface HapiIdpsRow extends HapiRowBase {
  population: number;
}

export interface HapiConflictRow extends HapiRowBase {
  event_type?: string;
  events: number | null;
  fatalities: number | null;
}

export interface HapiFundingRow extends HapiRowBase {
  appeal_code?: string;
  appeal_name?: string;
  requirements_usd: number | null;
  funding_usd: number | null;
  funding_pct?: number | null;
}

export interface HapiFoodSecurityRow extends HapiRowBase {
  ipc_phase: string;
  ipc_type?: string;
  population_in_phase: number | null;
  population_fraction_in_phase?: number | null;
}

export interface HapiLocationRow {
  code: string;
  name: string;
}

/** HAPI caps `limit` at 10,000 per request; the provider paginates via offset. */
export const HAPI_PAGE_LIMIT = 10_000;
const LOCATIONS_TTL_SECONDS = 7 * 24 * 3600;

export interface ThemeRequest {
  /** ISO3 filter; omit for all countries. */
  locationCode?: string;
  /** Server-side reference-period window (start_date/end_date params). */
  yearFrom?: number;
  yearTo?: number;
  /** Pagination offset in rows. */
  offset?: number;
}

export class HdxClient {
  constructor(
    private readonly http: HttpClient,
    private readonly appIdentifier: string,
  ) {}

  private url(path: string, params: Record<string, string | number>): string {
    const search = new URLSearchParams({
      app_identifier: this.appIdentifier,
      output_format: 'json',
      limit: String(HAPI_PAGE_LIMIT),
      offset: '0',
    });
    for (const [key, value] of Object.entries(params)) search.set(key, String(value));
    return `${HAPI_BASE_URL}/${path}?${search.toString()}`;
  }

  private async rows<T>(path: string, params: Record<string, string | number>): Promise<T[]> {
    const payload = await this.http.getJson<{ data?: T[] }>(this.url(path, params));
    return Array.isArray(payload.data) ? payload.data : [];
  }

  /** Country/location reference list (cached for a week). */
  async locations(): Promise<HapiLocationRow[]> {
    const url = this.url('metadata/location', {});
    const payload = await this.http.getJson<{ data?: HapiLocationRow[] }>(
      url,
      LOCATIONS_TTL_SECONDS,
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }

  /**
   * One page of rows for a theme (up to {@link HAPI_PAGE_LIMIT}); the
   * provider paginates via `offset` until a short page comes back. The year
   * window is passed server-side — a client-side year filter after
   * normalization stays as belt-and-braces, since reference periods can
   * straddle the window edges.
   */
  theme(theme: HdxTheme, request: ThemeRequest = {}): Promise<unknown[]> {
    const config = THEME_CONFIG[theme];
    const params: Record<string, string | number> = {};
    if (config.adminLevel !== undefined) params['admin_level'] = config.adminLevel;
    if (request.locationCode) params['location_code'] = request.locationCode.toUpperCase();
    if (request.yearFrom !== undefined) params['start_date'] = `${request.yearFrom}-01-01`;
    if (request.yearTo !== undefined) params['end_date'] = `${request.yearTo}-12-31`;
    if (request.offset) params['offset'] = request.offset;
    return this.rows<unknown>(config.path, params);
  }
}
