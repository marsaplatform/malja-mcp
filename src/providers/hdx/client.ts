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

/** Datasets this provider serves, mapped to HAPI endpoint paths. */
export const THEME_PATHS = {
  idps: 'affected-people/idps',
  'conflict-events': 'coordination-context/conflict-events',
  'humanitarian-funding': 'coordination-context/funding',
  'food-security': 'food-security-nutrition-poverty/food-security',
} as const;

export type HdxTheme = keyof typeof THEME_PATHS;

export const ALL_HDX_THEMES = Object.keys(THEME_PATHS) as HdxTheme[];

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

/** HAPI caps `limit` at 10,000 — one fetch covers a country's full series. */
const PAGE_LIMIT = 10_000;
const LOCATIONS_TTL_SECONDS = 7 * 24 * 3600;

export class HdxClient {
  constructor(
    private readonly http: HttpClient,
    private readonly appIdentifier: string,
  ) {}

  private url(path: string, params: Record<string, string | number>): string {
    const search = new URLSearchParams({
      app_identifier: this.appIdentifier,
      output_format: 'json',
      limit: String(PAGE_LIMIT),
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
   * All national-level rows for a theme, optionally filtered to one ISO3.
   * Year filtering happens in the provider (HAPI filters by reference
   * period, which crosses year boundaries).
   */
  theme(theme: HdxTheme, locationCode?: string): Promise<unknown[]> {
    const params: Record<string, string | number> = { admin_level: 0 };
    if (locationCode) params['location_code'] = locationCode.toUpperCase();
    return this.rows<unknown>(THEME_PATHS[theme], params);
  }
}
