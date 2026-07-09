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
import { ALL_WB_INDICATORS, WORLDBANK_BASE_URL, WorldBankClient } from './client.js';
import type { WbCountryRaw } from './client.js';
import { normalizeIndicatorRows } from './normalize.js';

/**
 * World Bank provider — serves the `context-indicators` dataset: national
 * population, GDP and poverty rates. These are the denominators that turn
 * absolute displacement figures into per-capita and per-GDP comparisons
 * (`normalize_by` on compare_countries / top_host_countries).
 *
 * Everything World-Bank-specific stays in this directory: the [meta, rows]
 * envelope, indicator ids, aggregate filtering.
 */

const DATASETS: ProviderMetadata['datasets'] = [
  {
    id: 'context-indicators',
    title: 'Context indicators (World Bank)',
    description:
      'National population, GDP (current US$), GDP per capita and extreme-poverty headcount ratio per country and year — denominator context for displacement figures.',
    metrics: ['national_population', 'gdp_usd', 'gdp_per_capita_usd', 'poverty_rate_pct'],
    citation:
      'World Bank Open Data (World Development Indicators), https://data.worldbank.org/ — CC BY 4.0',
  },
];

export class WorldBankProvider implements HumanitarianProvider {
  readonly id = 'worldbank';
  readonly name = 'World Bank Open Data';

  private readonly client: WorldBankClient;
  private countriesPromise: Promise<WbCountryRaw[]> | undefined;

  constructor(config: Config, cache: InstrumentedCache, logger: Logger) {
    const http = new HttpClient({
      cache,
      config,
      logger,
      limiter: new RateLimiter(config.rateLimitRps),
      provider: this.id,
    });
    this.client = new WorldBankClient(http);
  }

  /** Real countries only — WB lists ~50 aggregates ("Arab World"...) too. */
  private async realCountries(): Promise<WbCountryRaw[]> {
    this.countriesPromise ??= this.client.countries().catch((err: unknown) => {
      this.countriesPromise = undefined;
      throw err;
    });
    const all = await this.countriesPromise;
    return all.filter((c) => c.region?.value !== 'Aggregates' && c.id.length === 3);
  }

  private toRef(raw: WbCountryRaw): CountryRef {
    return {
      name: raw.name,
      iso3: raw.id.toUpperCase(),
      ...(raw.iso2Code ? { iso2: raw.iso2Code } : {}),
      ...(raw.region?.value ? { region: raw.region.value } : {}),
    };
  }

  async search(query: SearchQuery): Promise<CountryMatch[]> {
    const countries = await this.realCountries();
    const candidates = countries.map((c) => ({
      value: this.toRef(c),
      names: [c.name, c.id, c.iso2Code, ...arabicNamesFor(c.id.toUpperCase())],
    }));
    return matchCountries(query.query, candidates, query.limit ?? 5).map((m) => ({
      ...m.value,
      score: m.score,
    }));
  }

  async get(ref: string): Promise<CountryRef | null> {
    const countries = await this.realCountries();
    const upper = ref.trim().toUpperCase();
    const direct = countries.find((c) => c.id.toUpperCase() === upper);
    if (direct) return this.toRef(direct);
    const [best] = await this.search({ query: ref, limit: 1 });
    return best && best.score >= 0.6 ? best : null;
  }

  async countries(): Promise<CountryRef[]> {
    const all = await this.realCountries();
    return all.map((c) => this.toRef(c)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(query: ListQuery): Promise<Page<NormalizedRecord>> {
    if (query.dataset !== 'context-indicators') {
      return { items: [], page: query.page ?? 1, maxPages: 0, total: 0 };
    }

    const yearTo = query.yearTo ?? new Date().getFullYear();
    const yearFrom = query.yearFrom ?? yearTo - 9;
    // This dataset has no origin/asylum distinction: either filter is "the country".
    const target = query.asylum_iso3 ?? query.origin_iso3 ?? 'all';

    const perIndicator = await Promise.all(
      ALL_WB_INDICATORS.map((id) => this.client.indicator(id, target, yearFrom, yearTo)),
    );
    let rows = perIndicator.flat();

    if (target === 'all') {
      const real = new Set((await this.realCountries()).map((c) => c.id.toUpperCase()));
      rows = rows.filter((r) => real.has(r.countryiso3code?.toUpperCase()));
    }

    const records = normalizeIndicatorRows(rows, new Date().toISOString());
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
        'World Development Indicators from the World Bank: population, GDP and poverty per country and year. Read-only public API, no key required.',
      homepage: 'https://data.worldbank.org/',
      datasets: DATASETS,
      attribution: 'Data © World Bank, licensed CC BY 4.0.',
      terms: 'https://data.worldbank.org/summary-terms-of-use',
    });
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.realCountries();
      return {
        provider: this.id,
        ok: true,
        latencyMs: Date.now() - started,
        detail: `reachable at ${WORLDBANK_BASE_URL} (may be served from cache)`,
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
    if (dataset !== 'context-indicators' || !Array.isArray(raw)) return [];
    return normalizeIndicatorRows(raw as never, new Date().toISOString());
  }
}
