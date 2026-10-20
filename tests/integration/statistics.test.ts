import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { UnhcrProvider } from '../../src/providers/unhcr/index.js';
import { createServer } from '../../src/server.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * Changepoints + prediction intervals end-to-end, against recorded UNHCR
 * /population/ fixtures (Sudan by origin, Egypt as host). The clock is pinned
 * so "last 10 years" windows are stable. No network.
 */

type Text = { type: 'text'; text: string }[];

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

function fixtureFor(url: URL): string | undefined {
  if (!url.pathname.includes('/v1/population/')) return undefined;
  if (url.searchParams.get('coa') === 'ARE') return 'population-egypt-2010-2025.json';
  if (url.searchParams.get('coo') === 'SUD') return 'population-sudan-origin-2010-2025.json';
  return undefined;
}

describe('stronger statistics (recorded UNHCR fixtures)', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      let body = '{"page":1,"maxPages":0,"total":[],"items":[]}';
      if (url.pathname.includes('/countries/')) body = fixture('countries.json');
      const name = fixtureFor(url);
      if (name) {
        const envelope = JSON.parse(fixture(name)) as { items: { year: number }[] };
        const from = Number(url.searchParams.get('yearFrom') ?? 0);
        const to = Number(url.searchParams.get('yearTo') ?? 9999);
        envelope.items = envelope.items.filter((i) => i.year >= from && i.year <= to);
        body = JSON.stringify(envelope);
      }
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const config = loadConfig({ MALJA_RATE_LIMIT_RPS: '1000', MALJA_LOG_LEVEL: 'error' });
    const provider = new UnhcrProvider(
      config,
      new InstrumentedCache(new MemoryCache()),
      new Logger('error', () => {}),
    );
    const server = createServer(buildTestContext(provider));
    client = new Client({ name: 'stats-suite', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, `${name} should succeed`).toBeFalsy();
    return {
      text: (result.content as Text)[0]!.text,
      structured: result.structuredContent as Record<string, unknown>,
    };
  }

  it('trend_analysis reports the 2023 Sudan IDP break (structured + English text)', async () => {
    const { text, structured } = await call('trend_analysis', {
      country: 'Sudan',
      role: 'origin',
      metric: 'idps',
      year_from: 2010,
      year_to: 2025,
    });
    const changepoints = structured['changepoints'] as { year: number; level_shift: number }[];
    expect(changepoints.map((c) => c.year)).toContain(2023);
    expect(changepoints.find((c) => c.year === 2023)!.level_shift).toBe(6_196_505);
    expect((structured['segments'] as unknown[]).length).toBe(changepoints.length + 1);
    expect(text).toContain('**Changepoints (structural breaks):** ');
    expect(text).toContain('2023 (jump +6,196,505 vs prior trend; slope +341,773 → +43,243/year)');
  });

  it('trend_analysis in Arabic: localized changepoint line with RTL-safe signs', async () => {
    const { text } = await call('trend_analysis', {
      country: 'السودان',
      role: 'origin',
      metric: 'idps',
      year_from: 2010,
      year_to: 2025,
      locale: 'ar',
    });
    expect(text).toContain(
      '2023 (قفزة \u200E+6,196,505 مقارنةً بالاتجاه السابق؛ الميل من \u200E+341,773 إلى \u200E+43,243 سنوياً)',
    );
    expect(text).toContain('**نقاط التحوّل (الانقطاعات الهيكلية):**');
  });

  it('forecast adds 80/95% prediction intervals and flags the 2023 Egypt break', async () => {
    const { text, structured } = await call('forecast', { country: 'Egypt', years_ahead: 3 });
    const projected = structured['projected'] as Record<string, number>[];
    expect(projected).toHaveLength(3);
    expect(projected[0]).toEqual({
      year: 2026,
      value: 246_280,
      lower_80: 200_965,
      upper_80: 291_596,
      lower_95: 170_549,
      upper_95: 322_011,
    });
    expect(structured['fit_from']).toBe(2017);
    expect(structured['changepoints']).toEqual([
      { year: 2023, level_shift: expect.any(Number), slope_before: 12_177, slope_after: -10_237 },
    ]);
    expect(structured['intervals']).toContain('Student-t');
    expect(text).toContain(
      '| 2026 | 246,280 | projected | 200,965 | 291,596 | 170,549 | 322,011 |',
    );
    expect(text).toContain(
      'A structural break was detected in 2023; the line is fitted across it.',
    );
    expect(text).toContain('⚠️ Naive linear extrapolation');
  });

  it('forecast since_break fits only the post-break years', async () => {
    const { structured, text } = await call('forecast', {
      country: 'Sudan',
      role: 'origin',
      since_break: true,
    });
    expect(structured['fit_from']).toBe(2023);
    expect(structured['fit_to']).toBe(2025);
    expect(structured['method']).toContain('since the latest structural break');
    expect(text).toContain('the line is fitted on data since then only');
  });

  it('forecast chart (svg, Arabic): interval band, dashed projection, break marker, RTL', async () => {
    const { text, structured } = await call('forecast', {
      country: 'مصر',
      chart: 'svg',
      locale: 'ar',
    });
    const chart = structured['chart'] as { format: string; spec: string };
    expect(chart.format).toBe('svg');
    expect(chart.spec).toContain('<polygon');
    expect(chart.spec).toContain('stroke-dasharray="6 4"');
    expect(chart.spec).toContain('تحوّل 2023');
    expect(chart.spec).toContain('direction="rtl"');
    expect(chart.spec).toContain('فترة التنبؤ 95%');
    expect(chart.spec).toContain('مصر (متوقَّع)');
    expect(text).toContain('| 2026 | 246,280 | متوقَّع | 200,965 | 291,596 | 170,549 | 322,011 |');
  });

  it('forecast chart (chartjs / vega-lite) carries bands and markers', async () => {
    const chartjs = (await call('forecast', { country: 'Egypt', chart: 'chartjs' })).structured;
    const cfg = (chartjs['chart'] as { spec: Record<string, unknown> }).spec as {
      data: { datasets: { fill: unknown; borderDash?: number[] }[] };
      options: { plugins: { annotation?: { annotations: Record<string, unknown> } } };
    };
    expect(cfg.data.datasets.filter((d) => d.fill === '-1')).toHaveLength(2);
    expect(cfg.data.datasets.some((d) => d.borderDash)).toBe(true);
    expect(Object.keys(cfg.options.plugins.annotation!.annotations)).toEqual(['marker0']);

    const vega = (await call('forecast', { country: 'Egypt', chart: 'vega-lite' })).structured;
    const spec = (vega['chart'] as { spec: { layer: { mark: { type: string } }[] } }).spec;
    expect(spec.layer.map((l) => l.mark.type)).toEqual(['area', 'area', 'line', 'rule', 'text']);
  });

  it('generate_chart show_changepoints marks breaks per series', async () => {
    const { structured } = await call('generate_chart', {
      countries: ['Egypt'],
      format: 'svg',
      year_from: 2010,
      year_to: 2025,
      show_changepoints: true,
    });
    const svg = structured['spec'] as string;
    expect(svg).toContain('break 2013');
    expect(svg).toContain('stroke-dasharray="4 3"');
    const plain = await call('generate_chart', {
      countries: ['Egypt'],
      format: 'svg',
      year_from: 2010,
      year_to: 2025,
    });
    expect(plain.structured['spec']).not.toContain('break 2013');
  });
});
