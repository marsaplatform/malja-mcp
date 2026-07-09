import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { WorldBankProvider } from '../../src/providers/worldbank/index.js';

/**
 * World Bank provider against recorded fixtures — verifies the [meta, rows]
 * envelope handling, indicator merging, null-cell skipping and aggregate
 * filtering, without touching the network.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'worldbank');

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

const EMPTY = '[{"page":1,"pages":1,"per_page":20000,"total":0},[]]';

function stubFetch(): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    urls.push(url);
    let body = EMPTY;
    if (url.includes('/v2/country?')) body = fixtureText('countries.json');
    else if (url.includes('/country/egy/indicator/SP.POP.TOTL'))
      body = fixtureText('sp-pop-totl-egy.json');
    else if (url.includes('/country/egy/indicator/NY.GDP.MKTP.CD'))
      body = fixtureText('ny-gdp-mktp-egy.json');
    else if (url.includes('/country/egy/indicator/SI.POV.DDAY'))
      body = fixtureText('si-pov-dday-egy.json');
    else if (url.includes('/country/all/indicator/SP.POP.TOTL'))
      body = fixtureText('sp-pop-totl-all.json');
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, urls };
}

function buildProvider() {
  const config = loadConfig({ HMCP_RATE_LIMIT_RPS: '1000', HMCP_LOG_LEVEL: 'error' });
  const cache = new InstrumentedCache(new MemoryCache());
  return new WorldBankProvider(config, cache, new Logger('error', () => {}));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorldBankProvider', () => {
  it('resolves English and Arabic names through search(), excluding aggregates', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const byName = await provider.search({ query: 'jordan' });
    expect(byName[0]).toMatchObject({ iso3: 'JOR', score: 1 });

    const byArabic = await provider.search({ query: 'مصر' });
    expect(byArabic[0]).toMatchObject({ iso3: 'EGY', score: 1 });

    // "Arab World" is a WB aggregate, not a country — filtered out.
    const aggregates = await provider.search({ query: 'arab world' });
    expect(aggregates.find((m) => m.iso3 === 'ARB')).toBeUndefined();
  });

  it('merges indicators into one record per country-year, skipping null cells', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'context-indicators',
      asylum_iso3: 'EGY',
      yearFrom: 2022,
      yearTo: 2023,
    });

    expect(page.items).toHaveLength(2);
    const y2023 = page.items.find((r) => r.year === 2023)!;
    expect(y2023.country_code).toBe('EGY');
    expect(y2023.metrics['national_population']).toBe(112_716_598);
    expect(y2023.metrics['gdp_usd']).toBe(395_926_000_000);
    // 2023 poverty cell is null upstream — must be absent, not zero.
    expect(y2023.metrics['poverty_rate_pct']).toBeUndefined();
    // Headline figure is the national population.
    expect(y2023.population).toBe(112_716_598);

    const y2022 = page.items.find((r) => r.year === 2022)!;
    expect(y2022.metrics['poverty_rate_pct']).toBe(1.5);
  });

  it('filters World Bank aggregates out of all-country listings', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'context-indicators',
      groupBy: 'asylum',
      yearFrom: 2023,
      yearTo: 2023,
    });

    const codes = page.items.map((r) => r.country_code);
    expect(codes).toContain('EGY');
    expect(codes).toContain('JOR');
    expect(codes).not.toContain('ARB');
  });

  it('serves only the context-indicators dataset', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({ dataset: 'population' });
    expect(page.items).toEqual([]);
    expect(page.maxPages).toBe(0);

    const meta = await provider.metadata();
    expect(meta.datasets.map((d) => d.id)).toEqual(['context-indicators']);
    expect(meta.attribution).toContain('World Bank');
  });
});
