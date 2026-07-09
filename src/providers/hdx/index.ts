import type { InstrumentedCache } from '../../cache/index.js';
import type { Config } from '../../config.js';
import type { Logger } from '../../logger.js';
import { matchCountries } from '../../shared/country-match.js';
import { arabicNamesFor } from '../../shared/country-names-ar.js';
import { HttpClient } from '../../shared/http.js';
import { RateLimiter } from '../../shared/rate-limiter.js';
import type {
  CountryMatch,
  CountryRef,
  DatasetId,
  HumanitarianProvider,
  ListQuery,
  NormalizedRecord,
  Page,
  ProviderHealth,
  ProviderMetadata,
  SearchQuery,
} from '../types.js';
import { ALL_HDX_THEMES, HAPI_BASE_URL, HdxClient } from './client.js';
import type { HapiLocationRow, HdxTheme } from './client.js';
import { citationFor, normalizeTheme } from './normalize.js';

/**
 * HDX/HAPI provider — the Humanitarian Data Exchange's normalized API.
 * Serves four themes that complete the displacement picture UNHCR opens:
 * internal displacement (IOM DTM), conflict events (ACLED), humanitarian
 * funding (OCHA FTS) and food security (IPC).
 *
 * HAPI speaks ISO3 natively — no code translation needed — but requires a
 * free app identifier (HMCP_HDX_APP_ID); context.ts enforces that with an
 * actionable error before this class is ever constructed.
 */

export const HDX_PROVIDER_ID = 'hdx';

const DATASET_TITLES: Record<HdxTheme, { title: string; description: string; metrics: string[] }> =
  {
    idps: {
      title: 'Internally displaced people',
      description:
        'National IDP stock figures from IOM displacement tracking, latest assessment per year.',
      metrics: ['idps'],
    },
    'conflict-events': {
      title: 'Conflict events',
      description: 'Annual conflict event counts and fatalities per country (ACLED).',
      metrics: ['events', 'fatalities'],
    },
    'humanitarian-funding': {
      title: 'Humanitarian funding',
      description:
        'Humanitarian appeal requirements and funding received per country and year (OCHA FTS).',
      metrics: ['requirements_usd', 'funding_usd', 'funding_coverage_pct'],
    },
    'food-security': {
      title: 'Food security (IPC)',
      description:
        'People per IPC food-insecurity phase; headline = phase 3+ (crisis or worse). Latest current analysis per year.',
      metrics: [
        'ipc_phase_1',
        'ipc_phase_2',
        'ipc_phase_3',
        'ipc_phase_4',
        'ipc_phase_5',
        'ipc_phase_3plus',
        'analyzed_population',
      ],
    },
  };

export class HdxProvider implements HumanitarianProvider {
  readonly id = HDX_PROVIDER_ID;
  readonly name = 'Humanitarian Data Exchange (HAPI)';

  private readonly client: HdxClient;
  private locationsPromise: Promise<HapiLocationRow[]> | undefined;

  constructor(config: Config, cache: InstrumentedCache, logger: Logger, appIdentifier: string) {
    const http = new HttpClient({
      cache,
      config,
      logger,
      limiter: new RateLimiter(config.rateLimitRps),
      provider: this.id,
    });
    this.client = new HdxClient(http, appIdentifier);
  }

  private async locations(): Promise<HapiLocationRow[]> {
    this.locationsPromise ??= this.client.locations().catch((err: unknown) => {
      this.locationsPromise = undefined;
      throw err;
    });
    return this.locationsPromise;
  }

  async search(query: SearchQuery): Promise<CountryMatch[]> {
    const locations = await this.locations();
    const candidates = locations.map((location) => ({
      value: { name: location.name, iso3: location.code.toUpperCase() },
      names: [location.name, location.code, ...arabicNamesFor(location.code.toUpperCase())],
    }));
    return matchCountries(query.query, candidates, query.limit ?? 5).map((m) => ({
      ...m.value,
      score: m.score,
    }));
  }

  async get(ref: string): Promise<CountryRef | null> {
    const locations = await this.locations();
    const upper = ref.trim().toUpperCase();
    const direct = locations.find((l) => l.code.toUpperCase() === upper);
    if (direct) return { name: direct.name, iso3: direct.code.toUpperCase() };
    const [best] = await this.search({ query: ref, limit: 1 });
    return best && best.score >= 0.6 ? best : null;
  }

  async list(query: ListQuery): Promise<Page<NormalizedRecord>> {
    if (!ALL_HDX_THEMES.includes(query.dataset as HdxTheme)) {
      return { items: [], page: query.page ?? 1, maxPages: 0, total: 0 };
    }
    const theme = query.dataset as HdxTheme;
    // No origin/asylum distinction in these datasets: either filter is "the country".
    const iso3 = query.asylum_iso3 ?? query.origin_iso3;

    const rows = await this.client.theme(theme, iso3);
    let records = this.normalize(rows, theme as DatasetId);
    if (query.yearFrom !== undefined) records = records.filter((r) => r.year >= query.yearFrom!);
    if (query.yearTo !== undefined) records = records.filter((r) => r.year <= query.yearTo!);
    records.sort((a, b) =>
      a.country_code === b.country_code
        ? a.year - b.year
        : a.country_code.localeCompare(b.country_code),
    );

    const limit = Math.min(query.limit ?? 100, 5000);
    const page = query.page ?? 1;
    const start = (page - 1) * limit;
    return {
      items: records.slice(start, start + limit),
      page,
      maxPages: Math.max(1, Math.ceil(records.length / limit)),
      total: records.length,
    };
  }

  metadata(): Promise<ProviderMetadata> {
    return Promise.resolve({
      id: this.id,
      name: this.name,
      description:
        'Normalized humanitarian indicators from the Humanitarian Data Exchange (HAPI): internal displacement, conflict events, funding and food security. Free app identifier required.',
      homepage: 'https://data.humdata.org/',
      datasets: ALL_HDX_THEMES.map((theme) => ({
        id: theme as DatasetId,
        ...DATASET_TITLES[theme],
        citation: citationFor(theme),
      })),
      attribution:
        'Data via HDX HAPI © the original providers: IOM DTM (IDPs), ACLED (conflict events), OCHA FTS (funding), IPC (food security). Cite the original source, not HDX alone.',
      terms: 'https://data.humdata.org/faqs/terms',
    });
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.locations();
      return {
        provider: this.id,
        ok: true,
        latencyMs: Date.now() - started,
        detail: `reachable at ${HAPI_BASE_URL} (may be served from cache)`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        provider: this.id,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  normalize(raw: unknown, dataset: DatasetId): NormalizedRecord[] {
    if (!ALL_HDX_THEMES.includes(dataset as HdxTheme)) return [];
    return normalizeTheme(dataset as HdxTheme, raw, new Date().toISOString());
  }
}
