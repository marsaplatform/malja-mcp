import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { UnhcrProvider } from '../../src/providers/unhcr/index.js';

/**
 * UNHCR provider against recorded fixtures — verifies the provider hides
 * every UNHCR quirk (code translation, "-" cells, envelope shape) without
 * touching the network.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

const EMPTY_ENVELOPE = '{"page":1,"maxPages":0,"total":[],"items":[]}';

/** Route fetch calls to fixtures by URL pattern; record every URL. */
function stubFetch(): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    urls.push(url);
    let body = EMPTY_ENVELOPE;
    // Note: the API base is /population/v1/, so match "/v1/population/" for the dataset.
    if (url.includes('/countries/')) body = fixtureText('countries.json');
    else if (url.includes('/v1/population/') && url.includes('coa=ARE'))
      body = fixtureText('population-egypt-2023.json');
    else if (url.includes('/v1/population/') && url.includes('coo=SYR'))
      body = fixtureText('population-syria-origin-2023.json');
    else if (url.includes('/demographics/')) body = fixtureText('demographics-egypt-latest.json');
    else if (url.includes('/asylum-applications/'))
      body = fixtureText('asylum-applications-egypt-2023.json');
    else if (url.includes('/asylum-decisions/'))
      body = fixtureText('asylum-decisions-egypt-2023.json');
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, urls };
}

function buildProvider(offline = false, cache = new InstrumentedCache(new MemoryCache())) {
  const config = loadConfig({
    HMCP_OFFLINE: offline ? '1' : '0',
    HMCP_RATE_LIMIT_RPS: '1000',
    HMCP_LOG_LEVEL: 'error',
  });
  const provider = new UnhcrProvider(config, cache, new Logger('error', () => {}));
  return { provider, cache };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UnhcrProvider', () => {
  it('resolves names, ISO codes and aliases through search()', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const { provider } = buildProvider();

    const byName = await provider.search({ query: 'egypt' });
    expect(byName[0]).toMatchObject({ name: 'Egypt', iso3: 'EGY', score: 1 });

    const byAlias = await provider.search({ query: 'ivory coast' });
    expect(byAlias[0]!.iso3).toBe('CIV');

    const byIso = await provider.get('DZA');
    expect(byIso?.name).toBe('Algeria');
  });

  it('resolves Arabic country names through search() and get()', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const { provider } = buildProvider();

    const egypt = await provider.search({ query: 'مصر' });
    expect(egypt[0]).toMatchObject({ iso3: 'EGY', score: 1 });

    // Spelling variants: definite article and hamza forms fold together.
    const jordan = await provider.search({ query: 'الاردن' });
    expect(jordan[0]).toMatchObject({ iso3: 'JOR', score: 1 });

    const sudanRef = await provider.get('السودان');
    expect(sudanRef?.iso3).toBe('SDN');
  });

  it('translates ISO3 to UNHCR-internal codes in list() queries (EGY → coa=ARE)', async () => {
    const { impl, urls } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const { provider } = buildProvider();

    const page = await provider.list({
      dataset: 'population',
      asylum_iso3: 'EGY',
      yearFrom: 2023,
      yearTo: 2023,
    });

    const dataUrl = urls.find((u) => u.includes('/v1/population/'))!;
    expect(dataUrl).toContain('coa=ARE'); // NOT coa=EGY — UNHCR's own code
    expect(dataUrl).toContain('yearFrom=2023');

    // ...but the emitted records speak ISO3 only.
    expect(page.items[0]).toMatchObject({ country: 'Egypt', country_code: 'EGY', year: 2023 });
    expect(page.items[0]!.metrics['refugees']).toBe(240507);
  });

  it('passes groupBy through as coa_all/coo_all', async () => {
    const { impl, urls } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const { provider } = buildProvider();

    await provider.list({ dataset: 'population', groupBy: 'asylum', yearFrom: 2023, yearTo: 2023 });
    expect(urls.find((u) => u.includes('coa_all=true'))).toBeDefined();
  });

  it('exposes metadata with all four datasets and UNHCR attribution', async () => {
    const { provider } = buildProvider();
    const metadata = await provider.metadata();
    expect(metadata.datasets.map((d) => d.id)).toEqual([
      'population',
      'demographics',
      'asylum-applications',
      'asylum-decisions',
    ]);
    expect(metadata.attribution).toContain('UNHCR');
  });

  it('health() reports ok with latency when the API responds', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const { provider } = buildProvider();

    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.provider).toBe('unhcr');
  });

  it('health() reports failure detail when the API is unreachable', async () => {
    vi.stubGlobal('fetch', (async () => {
      throw new Error('network down');
    }) as typeof fetch);
    const { provider } = buildProvider();

    const health = await provider.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('network down');
  }, 15_000);

  it('offline mode serves previously cached data without any fetch', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const shared = new InstrumentedCache(new MemoryCache());

    // Warm the cache online.
    const online = buildProvider(false, shared);
    await online.provider.list({
      dataset: 'population',
      asylum_iso3: 'EGY',
      yearFrom: 2023,
      yearTo: 2023,
    });

    // Go offline: same cache, fetch must never fire.
    const neverCalled = vi.fn(async () => {
      throw new Error('offline mode must not fetch');
    });
    vi.stubGlobal('fetch', neverCalled as unknown as typeof fetch);

    const offline = buildProvider(true, shared);
    const page = await offline.provider.list({
      dataset: 'population',
      asylum_iso3: 'EGY',
      yearFrom: 2023,
      yearTo: 2023,
    });
    expect(page.items[0]!.country_code).toBe('EGY');
    expect(neverCalled).not.toHaveBeenCalled();
  });
});
