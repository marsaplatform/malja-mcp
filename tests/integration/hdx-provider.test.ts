import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { HdxProvider } from '../../src/providers/hdx/index.js';

/**
 * HDX/HAPI provider against recorded fixtures — verifies per-theme
 * aggregation semantics (stocks vs flows vs pivots), the app-identifier
 * requirement and original-source attribution, without touching the network.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'hdx');
const APP_ID = 'dGVzdDp0ZXN0QGV4YW1wbGUub3Jn';

function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function stubFetch(): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    urls.push(url);
    let body = '{"data":[]}';
    if (url.includes('/metadata/location')) body = fixtureText('locations.json');
    else if (url.includes('/affected-people/idps')) body = fixtureText('idps-sdn.json');
    else if (url.includes('/coordination-context/conflict-events'))
      body = fixtureText('conflict-events-sdn.json');
    else if (url.includes('/coordination-context/funding')) body = fixtureText('funding-sdn.json');
    else if (url.includes('/food-security-nutrition-poverty/food-security'))
      body = fixtureText('food-security-sdn.json');
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
  return new HdxProvider(config, cache, new Logger('error', () => {}), APP_ID);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HdxProvider', () => {
  it('sends the app identifier with every request', async () => {
    const { impl, urls } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    await provider.list({ dataset: 'conflict-events', asylum_iso3: 'SDN' });
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toContain(`app_identifier=${APP_ID}`);
  });

  it('idps: the latest assessment per year wins — rounds are not summed', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'idps',
      asylum_iso3: 'SDN',
      yearFrom: 2023,
      yearTo: 2024,
    });
    const y2023 = page.items.find((r) => r.year === 2023)!;
    // June round (5M) superseded by December round (6M) — not 11M.
    expect(y2023.metrics['idps']).toBe(6_000_000);
    expect(page.items.find((r) => r.year === 2024)!.metrics['idps']).toBe(8_000_000);
  });

  it('conflict-events: monthly and event-type rows sum into country-years', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'conflict-events',
      asylum_iso3: 'SDN',
      yearFrom: 2023,
      yearTo: 2023,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.metrics['events']).toBe(250); // 120 + 90 + 40
    expect(page.items[0]!.metrics['fatalities']).toBe(960); // 450 + 310 + 200
  });

  it('funding: appeals sum per year and coverage is recomputed, not averaged', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'humanitarian-funding',
      asylum_iso3: 'SDN',
      yearFrom: 2023,
      yearTo: 2023,
    });
    const record = page.items[0]!;
    expect(record.metrics['requirements_usd']).toBe(3_600_000_000);
    expect(record.metrics['funding_usd']).toBe(1_450_000_000);
    // 1.45bn / 3.6bn = 40.3% — averaging the appeals' 42.3/35.0 would be wrong.
    expect(record.metrics['funding_coverage_pct']).toBeCloseTo(40.3, 1);
  });

  it('food-security: phases pivot into one record; current beats projected; 3+ is the headline', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const page = await provider.list({
      dataset: 'food-security',
      asylum_iso3: 'SDN',
      yearFrom: 2024,
      yearTo: 2024,
    });
    expect(page.items).toHaveLength(1);
    const record = page.items[0]!;
    expect(record.metrics['ipc_phase_3']).toBe(15_000_000);
    expect(record.metrics['ipc_phase_5']).toBe(750_000);
    // Headline uses the current analysis (23.75M), not the projection (25M).
    expect(record.population).toBe(23_750_000);
  });

  it('attributes data to the original sources, not HDX alone', async () => {
    const provider = buildProvider();
    const meta = await provider.metadata();
    const citations = meta.datasets.map((d) => d.citation).join(' ');
    expect(citations).toContain('ACLED');
    expect(citations).toContain('IPC');
    expect(citations).toContain('OCHA FTS');
    expect(citations).toContain('IOM DTM');
    expect(meta.attribution).toContain('original source');
  });

  it('resolves Arabic names through search()', async () => {
    const { impl } = stubFetch();
    vi.stubGlobal('fetch', impl);
    const provider = buildProvider();

    const matches = await provider.search({ query: 'السودان' });
    expect(matches[0]).toMatchObject({ iso3: 'SDN', score: 1 });
  });
});
