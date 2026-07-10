import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { ReliefWebProvider } from '../../src/providers/reliefweb/index.js';

/**
 * ReliefWeb provider against recorded fixtures — verifies the documented v2
 * GET parameter encoding (appname, AND-combined filter conditions, date
 * ranges) and the report→record normalization, without touching the network.
 *
 * Fixtures follow the documented v2 envelope (https://apidoc.reliefweb.int/),
 * with synthetic hostile rows the live API rarely serves. Shape verified
 * against the real v2 API with an approved appname on 2026-07-10.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'reliefweb');

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function stubFetch(status = 200): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    urls.push(url);
    if (status !== 200) {
      return new Response('{"error":{"message":"not approved"}}', { status });
    }
    const body = url.includes('/v2/countries')
      ? fixtureText('countries.json')
      : fixtureText('reports-sdn.json');
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, urls };
}

function buildProvider() {
  const config = loadConfig({
    HMCP_RATE_LIMIT_RPS: '1000',
    HMCP_LOG_LEVEL: 'error',
    HMCP_RELIEFWEB_APPNAME: 'hmcp-test-abc123',
  });
  const cache = new InstrumentedCache(new MemoryCache());
  return new ReliefWebProvider(config, cache, new Logger('error', () => {}));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReliefWebProvider', () => {
  it('resolves English and Arabic names through search(), skipping iso3-less entries', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const byName = await provider.search({ query: 'sudan' });
    expect(byName[0]).toMatchObject({ iso3: 'SDN', score: 1 });

    const byArabic = await provider.search({ query: 'السودان' });
    expect(byArabic[0]).toMatchObject({ iso3: 'SDN' });

    // "World" has no iso3 in the fixture — it must never surface as a country.
    const all = await provider.countries!();
    expect(all.every((c) => c.iso3.length === 3)).toBe(true);
  });

  it('translates ListQuery into the documented v2 GET parameters', async () => {
    const { impl, urls } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    await provider.list({
      dataset: 'situation-reports',
      asylum_iso3: 'SDN',
      yearFrom: 2023,
      yearTo: 2024,
      page: 1,
      limit: 20,
    });

    const reportsUrl = decodeURIComponent(urls.find((u) => u.includes('/v2/reports')) ?? '');
    expect(reportsUrl).toContain('appname=hmcp-test-abc123');
    expect(reportsUrl).toContain('filter[operator]=AND');
    // ReliefWeb tags countries with lowercase iso3.
    expect(reportsUrl).toMatch(/filter\[conditions]\[\d]\[field]=country\.iso3/);
    expect(reportsUrl).toContain('=sdn');
    expect(reportsUrl).toMatch(/filter\[conditions]\[\d]\[field]=format\.name/);
    // URLSearchParams form-encodes the space as '+', which the API accepts.
    expect(reportsUrl).toMatch(/=Situation[+ ]Report/);
    expect(reportsUrl).toMatch(/\[value]\[from]=2023-01-01/);
    expect(reportsUrl).toMatch(/\[value]\[to]=2024-12-31/);
    expect(reportsUrl).toContain('sort[]=date.original:desc');
    expect(reportsUrl).toContain('limit=20');
    expect(reportsUrl).toContain('offset=0');
  });

  it('normalizes reports into one record each and pages by totalCount', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'situation-reports',
      asylum_iso3: 'SDN',
      yearFrom: 2023,
      yearTo: 2024,
      limit: 20,
    });

    // 5 fixture rows, 1 without a date → 4 records.
    expect(page.items).toHaveLength(4);
    for (const record of page.items) {
      expect(record.dataset).toBe('situation-reports');
      expect(record.source).toBe('reliefweb');
      expect(record.population).toBe(1);
    }
    expect(page.total).toBe(42);
    expect(page.maxPages).toBe(3); // ceil(42 / 20)
  });

  it('serves only the situation-reports dataset', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({ dataset: 'population' });
    expect(page.items).toEqual([]);
    expect(page.maxPages).toBe(0);

    const meta = await provider.metadata();
    expect(meta.datasets.map((d) => d.id)).toEqual(['situation-reports']);
    expect(meta.attribution).toContain('ReliefWeb');
  });

  it('serves documents with free-text search wired through query[value]', async () => {
    const { impl, urls } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const docs = await provider.documents!({ iso3: 'SDN', query: 'cholera', limit: 5 });
    // 5 fixture rows, 1 without a url → 4 documents.
    expect(docs).toHaveLength(4);
    expect(docs[0]!.url).toContain('https://reliefweb.int/');

    const reportsUrl = decodeURIComponent(urls.find((u) => u.includes('/v2/reports')) ?? '');
    expect(reportsUrl).toContain('query[value]=cholera');
    expect(reportsUrl).toContain('limit=5');
  });

  it('reports health ok against a reachable API', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.provider).toBe('reliefweb');
  });

  it('explains an unapproved appname when the API returns 403', async () => {
    const { impl } = stubFetch(403);
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const health = await provider.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/appname/i);
    expect(health.detail).toContain('apidoc.reliefweb.int');
  });
});
