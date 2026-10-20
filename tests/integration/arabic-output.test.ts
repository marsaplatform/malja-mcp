import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { ar } from '../../src/i18n/messages/ar.js';
import { Logger } from '../../src/logger.js';
import { UnhcrProvider } from '../../src/providers/unhcr/index.js';
import { createServer } from '../../src/server.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * Arabic (locale "ar") output, end to end through the MCP protocol, against
 * the deterministic mock provider and recorded UNHCR fixtures — no network.
 */

type Text = { type: string; text: string }[];

async function connect(env: NodeJS.ProcessEnv = {}, ctx = buildTestContext(undefined, env)) {
  const server = createServer(ctx);
  const client = new Client({ name: 'arabic-suite', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

/**
 * Latin words left in Arabic prose, ignoring code, URLs, tool/param names and
 * known proper nouns/codes. Used to catch untranslated strings.
 */
function englishLeftovers(text: string): string[] {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w-]+\.(?:org|int|com)\S*/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
  const allowed = new Set([
    'mock',
    'MOCK',
    'Mock',
    'ISO3',
    'IPC',
    'UNHCR',
    'HDX',
    'ACLED',
    'FTS',
    'ReliefWeb',
    'malja',
    'mcp',
    'search_country',
    'refugee_population',
    'provider_health',
    'year_from',
    'year_to',
  ]);
  return (stripped.match(/[A-Za-z_][A-Za-z_]{2,}/g) ?? []).filter(
    // Upper-case codes (ISO3 country codes, acronyms) are language-neutral.
    (w) => !allowed.has(w) && !/^[A-Z]{2,5}$/.test(w),
  );
}

describe('Arabic output (mock provider)', () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof connect>>['server'];

  beforeAll(async () => {
    ({ client, server } = await connect());
  });
  afterAll(async () => {
    await client.close();
    await server.close();
  });

  async function text(name: string, args: Record<string, unknown>, locale = 'ar') {
    const result = await client.callTool({ name, arguments: { ...args, locale } });
    return {
      text: (result.content as Text)[0]!.text,
      structured: result.structuredContent as Record<string, unknown>,
      isError: result.isError === true,
    };
  }

  it('every tool advertises an optional locale enum', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(15);
    for (const tool of tools) {
      const locale = (tool.inputSchema.properties as Record<string, { enum?: string[] }>)['locale'];
      expect(locale?.enum, tool.name).toEqual(['en', 'ar']);
      expect(tool.inputSchema.required ?? []).not.toContain('locale');
    }
  });

  it('country_profile: Arabic headings, labels and country names; structured output unchanged', async () => {
    const ar = await text('country_profile', { country: 'Egypt' });
    const en = await text('country_profile', { country: 'Egypt' }, 'en');
    expect(ar.text).toContain('# مصر — الملف الإنساني (2024)');
    expect(ar.text).toContain('## المستضافون داخل البلد');
    expect(ar.text).toContain('| المؤشر | عدد الأشخاص |');
    expect(ar.text).toContain('| اللاجئون | 190,000 |');
    expect(ar.text).toContain('| طالبو اللجوء | 1,000 |');
    expect(ar.text).toContain('**المنطقة:** أفريقيا');
    expect(englishLeftovers(ar.text)).toEqual([]);
    // Machine-readable output is identical in both locales.
    expect(ar.structured).toEqual(en.structured);
    expect(ar.structured['country']).toBe('Egypt');
    expect(Object.keys(ar.structured['hosted'] as object)).toEqual(['refugees', 'asylum_seekers']);
  });

  it('trend_analysis: Arabic analysis text with RTL-safe signed numbers', async () => {
    const { text: out } = await text('trend_analysis', {
      country: 'Jordan',
      year_from: 2022,
      year_to: 2024,
    });
    expect(out).toBe(
      [
        'الاتجاه — **اللاجئون**، الأردن (بحسب بلد اللجوء)، من 2022 إلى 2024',
        '',
        '| السنة | اللاجئون | التغيّر عن السنة السابقة | التغيّر % |',
        '| --- | --- | --- | --- |',
        '| 2022 | 670,000 | — | — |',
        '| 2023 | 680,000 | \u200E+10,000 | 1.5% |',
        '| 2024 | 690,000 | \u200E+10,000 | 1.5% |',
        '',
        '**الاتجاه العام:** تصاعدي (10,000 سنوياً، R²=1.00)',
        '**معدل النمو السنوي المركّب:** 1.5%',
        '**سنوات شاذة إحصائياً:** لم تُرصد أي سنة شاذة',
        '**نقاط التحوّل (الانقطاعات الهيكلية):** لم تُرصد أي نقطة تحوّل',
        '',
        ar.trend.changepointMethod,
        '',
        '_المصدر: mock_',
      ].join('\n'),
    );
  });

  it('generate_country_report: full Arabic report, Arabic progress, Arabic chart labels', async () => {
    const progress: string[] = [];
    const result = await client.callTool(
      { name: 'generate_country_report', arguments: { country: 'Sudan', locale: 'ar' } },
      undefined,
      { onprogress: (p) => void (p.message && progress.push(p.message)) },
    );
    const report = (result.content as Text)[0]!.text;
    expect(report.startsWith('# السودان — تقرير عن الوضع الإنساني')).toBe(true);
    for (const heading of [
      '## أبرز الأرقام',
      '## تطوّر أعداد اللاجئين عبر السنوات',
      '## من أين يأتي اللاجئون',
      '## قرارات اللجوء (آخر 5 سنوات)',
      '## التركيبة الديموغرافية',
    ]) {
      expect(report).toContain(heading);
    }
    expect(report).toContain('title "اللاجئون المستضافون في السودان"');
    expect(report).toContain('x-axis "السنة"');
    expect(report).toContain('ملاحظات منهجية');
    expect(englishLeftovers(report)).toEqual([]);
    expect(progress).toContain('جارٍ إعداد التقرير');
    expect((result.structuredContent as { markdown: string }).markdown).toBe(report);
  });

  it('demographics, asylum, crisis and ranking tools speak Arabic', async () => {
    const cases: [string, Record<string, unknown>, string[]][] = [
      [
        'demographics',
        { country: 'Egypt' },
        ['| الفئة العمرية | الإناث | الذكور |', 'نسبة الإناث 47.5%'],
      ],
      [
        'asylum_decisions',
        { country: 'Egypt', year_from: 2024, year_to: 2024 },
        ['معدل الاعتراف', '| 2024 | 8,000 | 500 |'],
      ],
      [
        'asylum_applications',
        { country: 'Egypt', year_from: 2024, year_to: 2024 },
        ['طلبات اللجوء — **مصر**'],
      ],
      [
        'food_security',
        { country: 'Sudan' },
        ['المرحلة 5 — الكارثة/المجاعة', 'في مرحلة الأزمة أو أسوأ'],
      ],
      [
        'humanitarian_funding',
        { country: 'Sudan', year_from: 2024, year_to: 2024 },
        ['نسبة التغطية', '58%'],
      ],
      [
        'conflict_events',
        { country: 'Sudan', year_from: 2024, year_to: 2024 },
        ['أحداث النزاع — **السودان**'],
      ],
      [
        'situation_reports',
        { country: 'Sudan', year_from: 2024, year_to: 2024 },
        ['**أحدث التقارير**'],
      ],
      [
        'top_host_countries',
        { limit: 2, normalize_by: 'population' },
        ['البلدان المضيفة', 'لكل 1,000 نسمة', '| 1 | الأردن |'],
      ],
      [
        'compare_countries',
        { countries: ['Egypt', 'Jordan'], year_from: 2023, year_to: 2024 },
        ['| السنة | مصر | الأردن |', 'أحدث القيم (2024)'],
      ],
      ['latest_statistics', {}, ['أحدث الإحصاءات — **العالم**']],
      [
        'refugee_population',
        { country: 'Egypt', year_from: 2024, year_to: 2024 },
        ['إجمالي المشمولين بالاهتمام'],
      ],
      ['forecast', { country: 'Egypt', years_ahead: 1 }, ['متوقَّع', 'استقراء خطي']],
      ['search_country', { query: 'syria' }, ['| سوريا | SYR | آسيا |']],
      ['provider_health', {}, ['✅ يعمل']],
      ['get_metadata', {}, ['التمويل الإنساني (`humanitarian-funding`)']],
    ];
    for (const [name, args, needles] of cases) {
      const out = await text(name, args);
      expect(out.isError, name).toBe(false);
      for (const needle of needles) expect(out.text, name).toContain(needle);
    }
  });

  it('forecast caveat is localized in structured output too', async () => {
    const { structured } = await text('forecast', { country: 'Egypt' });
    expect(structured['caveat']).toContain('استقراء خطي');
    expect(structured['method']).toBe('ordinary least squares over the last 10 observed years');
  });

  it('errors come back in Arabic', async () => {
    const missing = await text('country_profile', { country: 'Atlantis' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe('لم يُعثر على بلد يطابق «Atlantis». جرّب أداة search_country أولاً.');

    const range = await text('compare_countries', {
      countries: ['Egypt', 'Jordan'],
      year_from: 2025,
      year_to: 2020,
    });
    expect(range.isError).toBe(true);
    expect(range.text).toContain('يجب ألا تكون سنة البداية');
  });

  it('SVG charts are RTL-aware with Arabic titles, legend and ticks', async () => {
    const { structured } = await text('generate_chart', {
      countries: ['Egypt', 'Jordan'],
      format: 'svg',
      year_from: 2023,
      year_to: 2024,
    });
    const svg = structured['spec'] as string;
    expect(structured['title']).toBe('اللاجئون (بحسب بلد اللجوء)، من 2023 إلى 2024 — MOCK');
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain('Noto Sans Arabic');
    expect(svg).toContain('>مصر</text>');
    expect(svg).toContain('ألف</text>');
  });

  it('Chart.js specs carry RTL legend/tooltip options', async () => {
    const { structured } = await text('generate_chart', {
      countries: ['Egypt'],
      format: 'chartjs',
      year_from: 2023,
      year_to: 2024,
    });
    const spec = structured['spec'] as {
      options: { locale: string; plugins: { legend: { rtl: boolean } } };
    };
    expect(spec.options.locale).toBe('ar');
    expect(spec.options.plugins.legend.rtl).toBe(true);
  });

  it('export codebook is Arabic while field names and data stay machine-readable', async () => {
    const { text: out, structured } = await text('export_data', {
      dataset: 'population',
      format: 'csv',
      country: 'Egypt',
      year_from: 2024,
      year_to: 2024,
      include_codebook: true,
    });
    expect(out).toContain('## دليل المتغيرات');
    expect(out).toContain(
      '| refugees | اللاجئون المشمولون بولاية المفوضية، رصيد نهاية العام. | أشخاص |',
    );
    expect(structured['data'] as string).toContain('country,country_code,');
    expect(structured['data'] as string).toMatch(/^# malja-mcp extraction manifest/);
    const codebook = structured['codebook'] as { field: string; description: string }[];
    expect(codebook.map((c) => c.field)).toContain('asylum_seekers');
  });

  it('prompts accept locale="ar" and ask for an Arabic answer', async () => {
    const prompt = await client.getPrompt({
      name: 'summarize_situation',
      arguments: { country: 'Sudan', locale: 'ar' },
    });
    const body = (prompt.messages[0]!.content as { text: string }).text;
    expect(body).toContain('بالعربية الفصحى');
    expect(body).toContain('locale="ar"');
    const english = await client.getPrompt({
      name: 'summarize_situation',
      arguments: { country: 'Sudan' },
    });
    expect((english.messages[0]!.content as { text: string }).text).not.toMatch(/[\u0600-\u06FF]/);
  });
});

describe('server-wide locale defaults', () => {
  it('MALJA_LOCALE=ar makes Arabic the default; locale="en" still overrides', async () => {
    const { client, server } = await connect({ MALJA_LOCALE: 'ar' });
    const call = async (args: Record<string, unknown>) =>
      ((await client.callTool({ name: 'latest_statistics', arguments: args })).content as Text)[0]!
        .text;
    expect(await call({})).toContain('أحدث الإحصاءات');
    expect(await call({ locale: 'en' })).toContain('Latest statistics — **Global**');
    const report = await client.readResource({ uri: 'report://SDN' });
    expect((report.contents[0] as { text: string }).text).toContain('تقرير عن الوضع الإنساني');
    await client.close();
    await server.close();
  });

  it('MALJA_DIGITS=arab switches Arabic output to Arabic-Indic digits only', async () => {
    const { client, server } = await connect({ MALJA_DIGITS: 'arab' });
    const call = async (locale: string) =>
      (
        (
          await client.callTool({
            name: 'humanitarian_funding',
            arguments: { country: 'Sudan', year_from: 2024, year_to: 2024, locale },
          })
        ).content as Text
      )[0]!.text;
    const ar = await call('ar');
    expect(ar).toContain('| ٢٠٢٤ | ٥٠٠٬٠٠٠٬٠٠٠ | ٢٩٠٬٠٠٠٬٠٠٠ | ٥٨٪ |');
    expect(ar).toContain('التمويل الإنساني — **السودان**، ٢٠٢٤');
    expect(await call('en')).toContain('| 2024 | 500,000,000 | 290,000,000 | 58% |');
    await client.close();
    await server.close();
  });
});

describe('Arabic output (UNHCR fixtures)', () => {
  const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');
  const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

  afterEach(() => vi.unstubAllGlobals());

  it('refugee_population for Egypt 2023 uses UN Arabic names and an Arabic producer label', async () => {
    vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      let body = '{"page":1,"maxPages":0,"total":[],"items":[]}';
      if (url.includes('/countries/')) body = fixture('countries.json');
      else if (url.includes('/v1/population/') && url.includes('coa=ARE'))
        body = fixture('population-egypt-2023.json');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);

    const config = loadConfig({ MALJA_RATE_LIMIT_RPS: '1000', MALJA_LOG_LEVEL: 'error' });
    const provider = new UnhcrProvider(
      config,
      new InstrumentedCache(new MemoryCache()),
      new Logger('error', () => {}),
    );
    const { client, server } = await connect({}, buildTestContext(provider));

    const result = await client.callTool({
      name: 'refugee_population',
      arguments: { country: 'مصر', year_from: 2023, year_to: 2023, locale: 'ar' },
    });
    const out = (result.content as Text)[0]!.text;
    expect(result.isError).toBeFalsy();
    expect(out).toContain('أرقام النزوح — **مصر** (بحسب بلد اللجوء)، 2023');
    expect(out).toContain('| السنة | اللاجئون | طالبو اللجوء | النازحون داخلياً | عديمو الجنسية |');
    expect(out).toMatch(
      /_المصدر: المفوضية السامية للأمم المتحدة لشؤون اللاجئين \(UNHCR\) — .*UNHCR/,
    );
    const records = (result.structuredContent as { records: { country_code: string }[] }).records;
    expect(records[0]!.country_code).toBe('EGY');

    await client.close();
    await server.close();
  });
});
