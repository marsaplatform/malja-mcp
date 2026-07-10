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
  DocumentItem,
  DocumentQuery,
  HumanitarianProvider,
  ListQuery,
  NormalizedRecord,
  Page,
  ProviderHealth,
  ProviderMetadata,
  SearchQuery,
} from '../types.js';
import {
  RELIEFWEB_APPNAME_DOCS,
  RELIEFWEB_BASE_URL,
  ReliefWebClient,
  type RwCountryRaw,
  type RwListResponse,
} from './client.js';
import { normalizeReports, toDocuments } from './normalize.js';

/**
 * ReliefWeb provider — serves the `situation-reports` dataset (report counts
 * per country and year) and the optional `documents()` capability (titles,
 * publishers and links of the actual reports). This is the narrative
 * counterpart to the numeric providers: use it to ground trends and
 * anomalies in what was actually reported at the time.
 *
 * Everything ReliefWeb-specific stays in this directory: the v2 envelope,
 * the filter-condition encoding, lowercase iso3 tags, the appname policy.
 */

const MAX_PAGE_LIMIT = 1000; // ReliefWeb's per-request ceiling
const MAX_DOCUMENTS = 50;

type RwCountry = RwCountryRaw & { iso3: string };

const DATASETS: ProviderMetadata['datasets'] = [
  {
    id: 'situation-reports',
    title: 'Situation reports (ReliefWeb)',
    description:
      'Humanitarian situation reports curated by ReliefWeb (OCHA), counted per country and year — with the underlying report titles and links available for narrative context.',
    metrics: ['reports'],
    citation: 'ReliefWeb (OCHA), https://reliefweb.int/',
  },
];

export class ReliefWebProvider implements HumanitarianProvider {
  readonly id = 'reliefweb';
  readonly name = 'ReliefWeb';

  private readonly client: ReliefWebClient;
  private countriesPromise: Promise<RwCountryRaw[]> | undefined;

  constructor(config: Config, cache: InstrumentedCache, logger: Logger) {
    const http = new HttpClient({
      cache,
      config,
      logger,
      limiter: new RateLimiter(config.rateLimitRps),
      provider: this.id,
    });
    this.client = new ReliefWebClient(http, config.reliefwebAppname);
  }

  /** Countries with a usable ISO3 — ReliefWeb also lists "World" etc. */
  private async knownCountries(): Promise<RwCountry[]> {
    this.countriesPromise ??= this.client.countries().catch((err: unknown) => {
      this.countriesPromise = undefined;
      throw err;
    });
    const all = await this.countriesPromise;
    return all.filter((c): c is RwCountry => typeof c.iso3 === 'string' && c.iso3.length === 3);
  }

  private toRef(raw: RwCountry): CountryRef {
    return {
      name: raw.name ?? raw.shortname ?? raw.iso3.toUpperCase(),
      iso3: raw.iso3.toUpperCase(),
    };
  }

  async search(query: SearchQuery): Promise<CountryMatch[]> {
    const countries = await this.knownCountries();
    const candidates = countries.map((c) => ({
      value: this.toRef(c),
      names: [
        ...(c.name ? [c.name] : []),
        ...(c.shortname ? [c.shortname] : []),
        c.iso3,
        ...arabicNamesFor(c.iso3.toUpperCase()),
      ],
    }));
    return matchCountries(query.query, candidates, query.limit ?? 5).map((m) => ({
      ...m.value,
      score: m.score,
    }));
  }

  async get(ref: string): Promise<CountryRef | null> {
    const countries = await this.knownCountries();
    const upper = ref.trim().toUpperCase();
    const direct = countries.find((c) => c.iso3.toUpperCase() === upper);
    if (direct) return this.toRef(direct);
    const [best] = await this.search({ query: ref, limit: 1 });
    return best && best.score >= 0.6 ? best : null;
  }

  async countries(): Promise<CountryRef[]> {
    const all = await this.knownCountries();
    return all.map((c) => this.toRef(c)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(query: ListQuery): Promise<Page<NormalizedRecord>> {
    if (query.dataset !== 'situation-reports') {
      return { items: [], page: query.page ?? 1, maxPages: 0, total: 0 };
    }

    const limit = Math.min(query.limit ?? 100, MAX_PAGE_LIMIT);
    const page = query.page ?? 1;
    const response = await this.client.reports({
      // No origin/asylum distinction: either filter is "the country".
      ...((query.asylum_iso3 ?? query.origin_iso3)
        ? { iso3: query.asylum_iso3 ?? query.origin_iso3 }
        : {}),
      ...(query.yearFrom !== undefined ? { yearFrom: query.yearFrom } : {}),
      ...(query.yearTo !== undefined ? { yearTo: query.yearTo } : {}),
      limit,
      offset: (page - 1) * limit,
    });

    const items = normalizeReports(response.data ?? [], new Date().toISOString());
    const total = response.totalCount;
    return {
      items,
      page,
      ...(total !== undefined ? { maxPages: Math.max(1, Math.ceil(total / limit)), total } : {}),
    };
  }

  async documents(query: DocumentQuery): Promise<DocumentItem[]> {
    const response = await this.client.reports({
      ...(query.iso3 ? { iso3: query.iso3 } : {}),
      ...(query.query ? { query: query.query } : {}),
      ...(query.yearFrom !== undefined ? { yearFrom: query.yearFrom } : {}),
      ...(query.yearTo !== undefined ? { yearTo: query.yearTo } : {}),
      limit: Math.min(Math.max(query.limit ?? 5, 1), MAX_DOCUMENTS),
      offset: 0,
    });
    return toDocuments(response.data ?? []);
  }

  metadata(): Promise<ProviderMetadata> {
    return Promise.resolve({
      id: this.id,
      name: this.name,
      description:
        'Situation reports curated by ReliefWeb, the humanitarian information service of UN OCHA. Read-only public API; requires a pre-approved appname.',
      homepage: 'https://reliefweb.int/',
      datasets: DATASETS,
      attribution: 'Content curated by ReliefWeb (UN OCHA); © the publishing organisations.',
      terms: 'https://reliefweb.int/terms-conditions',
    });
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.probeOnce();
      return {
        provider: this.id,
        ok: true,
        latencyMs: Date.now() - started,
        detail: `reachable at ${RELIEFWEB_BASE_URL} (may be served from cache)`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const detail = message.includes('403')
        ? `${message} — ReliefWeb requires a pre-approved appname; request one at ${RELIEFWEB_APPNAME_DOCS} and set HMCP_RELIEFWEB_APPNAME.`
        : message;
      return {
        provider: this.id,
        ok: false,
        detail,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private probeOnce(): Promise<RwListResponse> {
    return this.client.probe();
  }

  normalize(raw: unknown, dataset: DatasetId): NormalizedRecord[] {
    if (dataset !== 'situation-reports') return [];
    const data = Array.isArray(raw) ? raw : ((raw as RwListResponse | undefined)?.data ?? []);
    return normalizeReports(data, new Date().toISOString());
  }
}
