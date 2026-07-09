import type { InstrumentedCache } from '../../cache/index.js';
import type { Config } from '../../config.js';
import type { Logger } from '../../logger.js';
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
import { UNHCR_BASE_URL, UnhcrClient } from './client.js';
import type { UnhcrDataEndpoint, UnhcrDataParams } from './client.js';
import { CountryIndex } from './codes.js';
import { normalizeRows } from './normalize.js';

/**
 * UNHCR provider — wraps the UNHCR Refugee Statistics API
 * (https://api.unhcr.org/population/v1) behind the provider contract.
 *
 * Everything UNHCR-specific stays in this directory: URL shapes, the
 * UNHCR-vs-ISO country code mismatch, "-" placeholders, metric names.
 */

const DATASETS: ProviderMetadata['datasets'] = [
  {
    id: 'population',
    title: 'Forcibly displaced populations',
    description:
      'End-year stocks of refugees, asylum-seekers, IDPs, stateless and other people of concern, by country of origin and country of asylum, 1951–present.',
    metrics: [
      'refugees',
      'asylum_seekers',
      'returned_refugees',
      'idps',
      'returned_idps',
      'stateless',
      'ooc',
      'oip',
      'hst',
    ],
    citation: 'UNHCR Refugee Data Finder, https://www.unhcr.org/refugee-statistics/',
  },
  {
    id: 'demographics',
    title: 'Demographics (age and sex)',
    description:
      'Age/sex breakdown of people UNHCR protects or assists, by country. Recent years only.',
    metrics: [
      'f_0_4',
      'f_5_11',
      'f_12_17',
      'f_18_59',
      'f_60',
      'f_total',
      'm_0_4',
      'm_5_11',
      'm_12_17',
      'm_18_59',
      'm_60',
      'm_total',
      'total',
    ],
    citation: 'UNHCR Refugee Data Finder, https://www.unhcr.org/refugee-statistics/',
  },
  {
    id: 'asylum-applications',
    title: 'Asylum applications',
    description: 'Individual asylum applications lodged, by year, origin and country of asylum.',
    metrics: ['applied'],
    citation: 'UNHCR Refugee Data Finder, https://www.unhcr.org/refugee-statistics/',
  },
  {
    id: 'asylum-decisions',
    title: 'Asylum decisions',
    description:
      'Decisions on individual asylum applications: recognized, complementary protection, rejected, otherwise closed.',
    metrics: ['dec_recognized', 'dec_other', 'dec_rejected', 'dec_closed', 'dec_total'],
    citation: 'UNHCR Refugee Data Finder, https://www.unhcr.org/refugee-statistics/',
  },
];

export class UnhcrProvider implements HumanitarianProvider {
  readonly id = 'unhcr';
  readonly name = 'UNHCR Refugee Statistics';

  private readonly client: UnhcrClient;
  private readonly index: CountryIndex;

  constructor(config: Config, cache: InstrumentedCache, logger: Logger) {
    const http = new HttpClient({
      cache,
      config,
      logger,
      limiter: new RateLimiter(config.rateLimitRps),
      provider: this.id,
    });
    this.client = new UnhcrClient(http);
    this.index = new CountryIndex(this.client);
  }

  async search(query: SearchQuery): Promise<CountryMatch[]> {
    const matches = await this.index.search(query.query, query.limit ?? 5);
    return matches.map(({ unhcrCode: _unhcrCode, ...match }) => match);
  }

  async get(ref: string): Promise<CountryRef | null> {
    const country = await this.index.resolve(ref);
    if (!country) return null;
    const { unhcrCode: _unhcrCode, ...rest } = country;
    return rest;
  }

  async countries(): Promise<CountryRef[]> {
    const all = await this.index.list();
    return all.map(({ unhcrCode: _unhcrCode, ...rest }) => rest);
  }

  async list(query: ListQuery): Promise<Page<NormalizedRecord>> {
    if (!DATASETS.some((d) => d.id === query.dataset)) {
      return { items: [], page: query.page ?? 1, maxPages: 0, total: 0 };
    }
    const endpoint = query.dataset as UnhcrDataEndpoint;

    const params: UnhcrDataParams = {
      page: query.page ?? 1,
      limit: Math.min(query.limit ?? 100, 1000),
    };

    if (query.asylum_iso3) {
      const country = await this.index.resolve(query.asylum_iso3);
      params.coa = country?.unhcrCode ?? query.asylum_iso3;
    }
    if (query.origin_iso3) {
      const country = await this.index.resolve(query.origin_iso3);
      params.coo = country?.unhcrCode ?? query.origin_iso3;
    }
    if (query.yearFrom !== undefined) params.yearFrom = query.yearFrom;
    if (query.yearTo !== undefined) params.yearTo = query.yearTo;
    if (query.groupBy === 'asylum') params.coa_all = true;
    if (query.groupBy === 'origin') params.coo_all = true;

    const envelope = await this.client.data(endpoint, params);
    const items = this.normalize(envelope.items, query.dataset);

    const total =
      typeof envelope.total === 'object' && envelope.total !== null && 'total' in envelope.total
        ? Number((envelope.total as Record<string, unknown>)['total'])
        : undefined;

    return {
      items,
      page: envelope.page,
      maxPages: envelope.maxPages,
      ...(total !== undefined && Number.isFinite(total) ? { total } : {}),
    };
  }

  metadata(): Promise<ProviderMetadata> {
    return Promise.resolve({
      id: this.id,
      name: this.name,
      description:
        'Official UNHCR statistics on forcibly displaced and stateless people worldwide, from 1951 to the present. Read-only public API, no key required.',
      homepage: 'https://www.unhcr.org/refugee-statistics/',
      datasets: DATASETS,
      attribution: 'Data © UNHCR, The UN Refugee Agency. Refugee Data Finder.',
      terms: 'https://www.unhcr.org/terms-and-conditions-data',
    });
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.client.countries();
      return {
        provider: this.id,
        ok: true,
        latencyMs: Date.now() - started,
        detail: `reachable at ${UNHCR_BASE_URL} (may be served from cache)`,
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
    const items = Array.isArray(raw) ? raw : [];
    return normalizeRows(items, dataset, new Date().toISOString());
  }
}
