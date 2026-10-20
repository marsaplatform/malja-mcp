import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import type { AppContext } from '../../src/context.js';
import { Logger } from '../../src/logger.js';
import { UnhcrProvider } from '../../src/providers/unhcr/index.js';
import { createServer } from '../../src/server.js';
import type { MonitorEvent, MonitorSnapshot } from '../../src/shared/monitor.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * monitor_changes end to end through MCP, against recorded UNHCR data for
 * Sudan (as asylum country, 2016–2025) and the mock provider — no network.
 */

type Event = MonitorEvent & { message: string };
type Structured = {
  latest_year: number;
  previous_year: number;
  baseline: { kind: string; taken_at: string | null; latest_year: number | null };
  metrics: { metric: string; previous: number; latest: number; change: number }[];
  events: Event[];
  summary: {
    total: number;
    new: number;
    warning: number;
    notice: number;
    info: number;
    has_alerts: boolean;
  };
  snapshot: MonitorSnapshot;
  snapshot_stored: boolean;
};

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

function stubUnhcr(mutate: (item: Record<string, unknown>) => void = () => {}) {
  const population = JSON.parse(fixture('population-sudan-2016-2025.json')) as {
    items: ({ year: number } & Record<string, unknown>)[];
  };
  population.items.forEach(mutate);
  vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    let body: unknown = { page: 1, maxPages: 0, total: [], items: [] };
    if (url.pathname.includes('/countries/')) body = JSON.parse(fixture('countries.json'));
    else if (url.pathname.includes('/population/') && url.searchParams.get('coa') === 'SUD') {
      const from = Number(url.searchParams.get('yearFrom') ?? 0);
      const to = Number(url.searchParams.get('yearTo') ?? 9999);
      body = {
        ...population,
        items: population.items.filter((i) => i.year >= from && i.year <= to),
      };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch);
}

function unhcrContext(): AppContext {
  const config = loadConfig({ MALJA_RATE_LIMIT_RPS: '1000', MALJA_LOG_LEVEL: 'error' });
  const provider = new UnhcrProvider(
    config,
    new InstrumentedCache(new MemoryCache()),
    new Logger('error', () => {}),
  );
  return buildTestContext(provider);
}

const closers: (() => Promise<void>)[] = [];
async function connect(ctx: AppContext) {
  const server = createServer(ctx);
  const client = new Client({ name: 'monitor-suite', version: '1.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'monitor_changes', arguments: args });
    return {
      isError: result.isError === true,
      text: (result.content as { text: string }[])[0]!.text,
      structured: result.structuredContent as Structured,
    };
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-01T08:00:00Z'));
});
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('monitor_changes (UNHCR fixtures, Sudan)', () => {
  it('first check: year-over-year events in Arabic, alert-ready structure, snapshot stored', async () => {
    stubUnhcr();
    const call = await connect(unhcrContext());
    const { text, structured, isError } = await call({
      country: 'السودان',
      locale: 'ar',
      thresholds: [{ metric: 'idps', value: 10_000_000 }],
    });
    expect(isError).toBe(false);
    expect(structured).toMatchObject({
      latest_year: 2025,
      previous_year: 2024,
      baseline: { kind: 'none', taken_at: null },
      snapshot_stored: true,
      summary: { total: 7, new: 7, warning: 2, notice: 2, info: 3, has_alerts: true },
    });
    const byId = Object.fromEntries(structured.events.map((e) => [e.id, e]));
    expect(byId['SDN:asylum:threshold:idps:10000000:down:2025']).toMatchObject({
      type: 'threshold_crossing',
      severity: 'warning',
      previous: 11_559_970,
      current: 9_139_309,
    });
    expect(byId['SDN:asylum:jump:returned_idps:2025']).toMatchObject({
      severity: 'warning',
      previous: 0,
      current: 2_913_113,
    });
    expect(byId['SDN:asylum:jump:idps:2025']).toMatchObject({
      severity: 'notice',
      change_pct: -20.9,
    });
    expect(byId['SDN:asylum:jump:idps:2025']!.robust_z).toBeLessThan(-3.5);
    expect(byId['SDN:asylum:jump:returned_refugees:2025']).toMatchObject({ change_pct: -48.6 });
    // Metrics with no data (stateless, oip) are not watched by default.
    expect(structured.metrics.map((m) => m.metric)).toEqual([
      'refugees',
      'asylum_seekers',
      'idps',
      'returned_refugees',
      'returned_idps',
      'ooc',
    ]);

    expect(text).toContain('# رصد التغيّرات — السودان (بحسب بلد اللجوء)');
    expect(text).toContain('**أحدث سنة في البيانات:** 2025 (مقارنةً بعام 2024)');
    expect(text).toContain(
      '- **[تحذير]** النازحون داخلياً — نزل دون عتبة 10,000,000 في 2025 (من 11,559,970 إلى 9,139,309).',
    );
    expect(text).toContain(
      '| النازحون داخلياً | 11,559,970 | 9,139,309 | \u200E-2,420,661 | \u200E-20.9% |',
    );
    expect(text).toMatch(/_المصدر: المفوضية السامية/);
    for (const e of structured.events) expect(e.message).toMatch(/[\u0600-\u06FF]/);
  });

  it('second check compares against the stored snapshot: nothing new, no alert', async () => {
    stubUnhcr();
    const call = await connect(unhcrContext());
    await call({ country: 'Sudan' });
    const { text, structured } = await call({ country: 'Sudan' });
    expect(structured.baseline).toMatchObject({
      kind: 'stored',
      taken_at: '2026-06-01T08:00:00.000Z',
      latest_year: 2025,
    });
    expect(structured.summary).toMatchObject({ new: 0, has_alerts: false });
    expect(structured.events.every((e) => !e.new_since_snapshot)).toBe(true);
    expect(text).toContain('(already flagged at the baseline)');
  });

  it('a supplied older snapshot reveals the new release and revised years', async () => {
    stubUnhcr();
    const call = await connect(unhcrContext());
    const first = await call({ country: 'Sudan', store_snapshot: false });
    expect(first.structured.snapshot_stored).toBe(false);

    // Pretend the snapshot was taken before the 2025 release, with an earlier IDP estimate.
    const old = structuredClone(first.structured.snapshot);
    old.taken_at = '2025-06-01T00:00:00.000Z';
    old.latest_year = 2024;
    old.event_ids = [];
    for (const byYear of Object.values(old.values)) delete byYear['2025'];
    old.values['idps']!['2024'] = 11_400_000;

    const { structured, text } = await call({ country: 'Sudan', snapshot: old, locale: 'ar' });
    expect(structured.baseline).toMatchObject({ kind: 'supplied', latest_year: 2024 });
    const types = structured.events.map((e) => [e.type, e.metric, e.year]);
    expect(types).toContainEqual(['new_release', null, 2025]);
    expect(types).toContainEqual(['revision', 'idps', 2024]);
    const revision = structured.events.find((e) => e.type === 'revision')!;
    expect(revision).toMatchObject({
      severity: 'notice',
      previous: 11_400_000,
      current: 11_559_970,
    });
    expect(text).toContain('صدرت بيانات جديدة: أرقام عام 2025 متاحة الآن');
    expect(text).toContain(
      'النازحون داخلياً — عُدِّلت أرقام عام 2024 من 11,400,000 إلى 11,559,970',
    );
    expect(structured.summary.has_alerts).toBe(true);
  });

  it('treats unreported ("-") cells as missing, not zero', async () => {
    stubUnhcr((item) => {
      if (item.year === 2024) item['idps'] = '-';
    });
    const call = await connect(unhcrContext());
    const { structured } = await call({
      country: 'Sudan',
      thresholds: [{ metric: 'idps', value: 10_000_000 }],
    });
    expect(structured.metrics.find((m) => m.metric === 'idps')).toMatchObject({
      previous: null,
      latest: 9_139_309,
      change: null,
    });
    // No jump or crossing against a fabricated 0; only the record among reported years.
    expect(structured.events.filter((e) => e.metric === 'idps').map((e) => e.type)).toEqual([
      'record_high',
    ]);
  });

  it('rejects a snapshot of another series', async () => {
    stubUnhcr();
    const call = await connect(unhcrContext());
    const { isError, text } = await call({
      country: 'Sudan',
      locale: 'ar',
      snapshot: {
        version: 1,
        key: 'population:unhcr:EGY:asylum',
        taken_at: '2025-01-01T00:00:00Z',
        latest_year: 2024,
        values: {},
        event_ids: [],
      },
    });
    expect(isError).toBe(true);
    expect(text).toContain('اللقطة المُمرَّرة تخص سلسلة أخرى');
  });
});

describe('monitor_changes (mock provider)', () => {
  it('a steady series yields no events; English output', async () => {
    const call = await connect(buildTestContext());
    const { text, structured } = await call({ country: 'Egypt', history_years: 5 });
    expect(structured.events).toEqual([]);
    expect(structured.summary.has_alerts).toBe(false);
    expect(text).toContain('# Monitoring — Egypt');
    expect(text).toContain(
      'No new releases, revisions, significant jumps or threshold crossings detected.',
    );
  });
});
