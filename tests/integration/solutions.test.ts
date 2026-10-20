import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { Logger } from '../../src/logger.js';
import { UnhcrProvider } from '../../src/providers/unhcr/index.js';
import { createServer } from '../../src/server.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * durable_solutions + solutions:// — mock provider for semantics (flows,
 * not-reported vs zero, normalize_by, Arabic) and recorded UNHCR
 * /solutions/ fixtures for the real wire format. No network.
 */

type Text = { type: 'text'; text: string }[];

interface SolutionsOut {
  country_code: string;
  role: string;
  measure: string;
  years: {
    year: number;
    metrics: Record<string, number>;
    total: number;
    total_normalized?: number;
    denominator_year?: number;
  }[];
  period_totals: Record<string, number>;
  period_total: number;
  normalize_by: string;
  unit: string;
}

async function connect(ctx = buildTestContext()) {
  const server = createServer(ctx);
  const client = new Client({ name: 'solutions-suite', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Latin words left in Arabic text, ignoring codes, identifiers and URLs. */
function englishWords(text: string): string[] {
  const stripped = text.replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ');
  const allowed = new Set(['UNHCR', 'mock', 'role', 'origin', 'refugee_population']);
  return (stripped.match(/[A-Za-z_][A-Za-z_]{2,}/g) ?? [])
    .map((w) => w.replace(/^_+|_+$/g, ''))
    .filter((w) => !allowed.has(w) && !/^[A-Z]{2,5}$/.test(w));
}

describe('durable_solutions (mock provider)', () => {
  it('reports per-year flows and a period total, keeping "not reported" distinct from 0', async () => {
    const { client, close } = await connect();
    const result = await client.callTool({
      name: 'durable_solutions',
      arguments: { country: 'Syria', year_from: 2015, year_to: 2017 },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as unknown as SolutionsOut;
    expect(out).toMatchObject({ country_code: 'SYR', role: 'origin', measure: 'flow' });
    expect(out.years.map((y) => y.year)).toEqual([2015, 2016, 2017]);
    // 2016: resettlement not reported → absent, not 0.
    expect(out.years[1]!.metrics).not.toHaveProperty('resettlement');
    expect(out.years[0]!.metrics).toEqual({
      returned_refugees: 1_000,
      resettlement: 500,
      naturalisation: 100,
      returned_idps: 2_000,
    });
    // Flows sum across years.
    expect(out.period_totals['returned_refugees']).toBe(1_000 + 2_000 + 3_000);
    expect(out.period_totals['resettlement']).toBe(1_000);
    expect(out.period_total).toBe(out.years.reduce((s, y) => s + y.total, 0));

    const text = (result.content as Text)[0]!.text;
    expect(text).toContain('Durable solutions — **Syrian Arab Rep.** (origin side), 2015–2017');
    expect(text).toContain('| 2016 | 2,000 | — | 100 | 2,000 | 4,100 |');
    expect(text).toContain('| **Period total** | 6,000 | 1,000 | 300 | 6,000 | 13,300 |');
    expect(text).toContain('flows recorded during each year');
    await close();
  });

  it('asylum role filters by the host country and explains the perspective', async () => {
    const { client, close } = await connect();
    const result = await client.callTool({
      name: 'durable_solutions',
      arguments: { country: 'Egypt', role: 'asylum', year_from: 2023, year_to: 2024 },
    });
    const out = result.structuredContent as unknown as SolutionsOut;
    expect(out.role).toBe('asylum');
    expect(out.years[0]!.metrics).toEqual({ returned_refugees: 9_000, naturalisation: 100 });
    expect((result.content as Text)[0]!.text).toContain('Asylum view: refugees who left Egypt');
    await close();
  });

  it('normalize_by="population" adds per-1,000-resident totals with the denominator year', async () => {
    const { client, close } = await connect();
    const result = await client.callTool({
      name: 'durable_solutions',
      arguments: { country: 'Syria', year_from: 2023, year_to: 2023, normalize_by: 'population' },
    });
    const out = result.structuredContent as unknown as SolutionsOut;
    expect(out.unit).toBe('per 1,000 residents');
    // 2023: 9,000 + 500 + 100 + 2,000 = 11,600 over 22M residents.
    expect(out.years[0]!.total).toBe(11_600);
    expect(out.years[0]!.total_normalized).toBeCloseTo((11_600 / 22_000_000) * 1_000, 3);
    expect(out.years[0]!.denominator_year).toBe(2023);
    expect((result.content as Text)[0]!.text).toContain('Total per 1,000 residents');
    await close();
  });

  it('renders fully in Arabic with locale="ar" while structured output stays identical', async () => {
    const { client, close } = await connect();
    const args = { country: 'Syria', year_from: 2015, year_to: 2017 };
    const en = await client.callTool({ name: 'durable_solutions', arguments: args });
    const ar = await client.callTool({
      name: 'durable_solutions',
      arguments: { ...args, locale: 'ar' },
    });
    expect(ar.structuredContent).toEqual(en.structuredContent);
    const text = (ar.content as Text)[0]!.text;
    expect(text).toContain('الحلول الدائمة — **سوريا** (بحسب بلد المنشأ)، من 2015 إلى 2017');
    expect(text).toContain(
      '| السنة | عودة اللاجئين | إعادة التوطين | التجنّس | عودة النازحين داخلياً | إجمالي الحلول |',
    );
    expect(text).toContain('| **إجمالي الفترة** | 6,000 | 1,000 | 300 | 6,000 | 13,300 |');
    expect(text).toContain('**توزيع الحلول خلال الفترة:**');
    expect(text).toContain('منظور بلد المنشأ');
    expect(englishWords(text)).toEqual([]);
    await close();
  });

  it('returns a localized error when nothing was reported', async () => {
    const { client, close } = await connect();
    const result = await client.callTool({
      name: 'durable_solutions',
      arguments: { country: 'Jordan', year_from: 2030, year_to: 2031, locale: 'ar' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Text)[0]!.text).toContain('لا تتوفر بيانات عن الحلول الدائمة');
    await close();
  });

  it('export_data supports the solutions dataset with codebook entries', async () => {
    const { client, close } = await connect();
    const result = await client.callTool({
      name: 'export_data',
      arguments: {
        dataset: 'solutions',
        country: 'Syria',
        role: 'origin',
        year_from: 2023,
        year_to: 2023,
        format: 'csv',
        include_codebook: true,
      },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Text).map((c) => c.text).join('\n');
    expect(text).toContain('resettlement');
    expect(text).toContain('| naturalisation | Refugees who acquired the nationality');
    expect(text).toContain('a flow, not a stock');
    await close();
  });

  it('solutions://{code} serves 10-year origin-side flows as JSON', async () => {
    const { client, close } = await connect();
    const resource = await client.readResource({ uri: 'solutions://SYR' });
    const payload = JSON.parse((resource.contents[0] as { text: string }).text) as SolutionsOut & {
      citation: string;
    };
    expect(payload).toMatchObject({ country_code: 'SYR', role: 'origin', measure: 'flow' });
    expect(payload.years.length).toBeGreaterThan(0);
    await close();
  });
});

describe('durable_solutions (recorded UNHCR /solutions/ fixtures)', () => {
  const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');
  const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
  const urls: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    urls.length = 0;
  });

  /** Serve fixtures, honouring yearFrom/yearTo like the real API. */
  function stub(): void {
    vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      urls.push(url.href);
      let body = '{"page":1,"maxPages":0,"total":[],"items":[]}';
      if (url.pathname.includes('/countries/')) body = fixture('countries.json');
      else if (url.pathname.includes('/v1/solutions/')) {
        const name =
          url.searchParams.get('coo') === 'SYR'
            ? 'solutions-syria-origin.json'
            : url.searchParams.get('coa') === 'ARE'
              ? 'solutions-egypt-asylum.json'
              : undefined;
        if (name) {
          const envelope = JSON.parse(fixture(name)) as { items: { year: number }[] };
          const from = Number(url.searchParams.get('yearFrom') ?? 0);
          const to = Number(url.searchParams.get('yearTo') ?? 9999);
          envelope.items = envelope.items.filter((i) => i.year >= from && i.year <= to);
          body = JSON.stringify(envelope);
        }
      }
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
  }

  function unhcrContext() {
    const config = loadConfig({ MALJA_RATE_LIMIT_RPS: '1000', MALJA_LOG_LEVEL: 'error' });
    const provider = new UnhcrProvider(
      config,
      new InstrumentedCache(new MemoryCache()),
      new Logger('error', () => {}),
    );
    return buildTestContext(provider);
  }

  it('Syria (origin) 2020–2023 matches the published UNHCR figures', async () => {
    stub();
    const { client, close } = await connect(unhcrContext());
    const result = await client.callTool({
      name: 'durable_solutions',
      arguments: { country: 'Syria', year_from: 2020, year_to: 2023 },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as unknown as SolutionsOut;
    expect(out.years.find((y) => y.year === 2023)!.metrics).toEqual({
      returned_refugees: 37_552,
      resettlement: 33_388,
      naturalisation: 8_890,
      returned_idps: 155_325,
    });
    // Same totals the API reports for the 2020–2023 window.
    expect(out.period_totals).toEqual({
      returned_refugees: 163_900,
      resettlement: 86_847,
      naturalisation: 67_873,
      returned_idps: 554_123,
    });
    expect(urls.some((u) => u.includes('/v1/solutions/') && u.includes('coo=SYR'))).toBe(true);
    await close();
  });

  it('Egypt (asylum) uses UNHCR code ARE and keeps "-" cells as not reported', async () => {
    stub();
    const { client, close } = await connect(unhcrContext());
    const result = await client.callTool({
      name: 'durable_solutions',
      arguments: { country: 'مصر', role: 'asylum', year_from: 2023, year_to: 2024, locale: 'ar' },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as unknown as SolutionsOut;
    expect(out.years.map((y) => y.metrics)).toEqual([
      { returned_refugees: 841 },
      { returned_refugees: 9_453 },
    ]);
    expect(urls.some((u) => u.includes('/v1/solutions/') && u.includes('coa=ARE'))).toBe(true);
    const text = (result.content as Text)[0]!.text;
    expect(text).toContain('الحلول الدائمة — **مصر** (بحسب بلد اللجوء)، من 2023 إلى 2024');
    expect(text).toContain('| 2023 | 841 | — | — | — | 841 |');
    expect(text).toMatch(/_المصدر: المفوضية السامية للأمم المتحدة لشؤون اللاجئين \(UNHCR\) — /);
    await close();
  });
});
