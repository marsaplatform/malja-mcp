import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../src/server.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * Exercises every tool and prompt not already covered in depth by the
 * compliance suite, asserting on structured output shapes and values from
 * the deterministic mock provider.
 */

describe('tool surface', () => {
  const ctx = buildTestContext();
  const server = createServer(ctx);
  const client = new Client({ name: 'surface-suite', version: '1.0.0' });

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, `${name} should succeed`).toBeFalsy();
    return result.structuredContent as never;
  }

  it('country_profile assembles hosted + abroad + origins', async () => {
    const profile = await call('country_profile', { country: 'egypt' });
    expect(profile).toMatchObject({ country: 'Egypt', country_code: 'EGY', source: 'mock' });
    expect((profile as { hosted: Record<string, number> }).hosted['refugees']).toBeGreaterThan(0);
    expect(Array.isArray((profile as { top_origins: unknown[] }).top_origins)).toBe(true);
  });

  it('refugee_population cross-filters via other_country', async () => {
    const result = (await call('refugee_population', {
      country: 'Egypt',
      other_country: 'Syria',
      year_from: 2022,
      year_to: 2023,
    })) as { records: { origin_code?: string }[] };
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0]!.origin_code).toBe('SYR');
  });

  it('demographics returns age/sex buckets with totals', async () => {
    const demo = (await call('demographics', { country: 'Egypt' })) as {
      year: number;
      female: Record<string, number>;
      male: Record<string, number>;
      total: number;
    };
    expect(demo.year).toBe(2024);
    expect(demo.total).toBe(200_000);
    expect(demo.female['total']).toBe(95_000);
    expect(demo.male['0_4']).toBe(11_000);
  });

  it('latest_statistics works globally and per country', async () => {
    const globalStats = (await call('latest_statistics')) as { scope: string; year: number };
    expect(globalStats.scope).toBe('Global');

    const egypt = (await call('latest_statistics', { country: 'EGY' })) as {
      scope: string;
      figures: Record<string, number>;
    };
    expect(egypt.scope).toBe('Egypt');
    expect(egypt.figures['refugees']).toBeGreaterThan(0);
  });

  it('asylum_applications aggregates per year', async () => {
    const apps = (await call('asylum_applications', {
      country: 'Egypt',
      year_from: 2020,
      year_to: 2023,
    })) as { yearly: { year: number; applied: number }[] };
    expect(apps.yearly.map((y) => y.year)).toEqual([2020, 2021, 2022, 2023]);
    expect(apps.yearly[1]!.applied).toBe(21_000);
  });

  it('asylum_decisions computes the recognition rate', async () => {
    const decisions = (await call('asylum_decisions', {
      country: 'Egypt',
      year_from: 2022,
      year_to: 2023,
    })) as { yearly: { recognition_rate_pct: number | null; total: number }[] };
    // (8000 recognized + 500 complementary) / (8000 + 500 + 1500) substantive = 85%
    expect(decisions.yearly[0]!.recognition_rate_pct).toBe(85);
    expect(decisions.yearly[0]!.total).toBe(12_000);
  });

  it('forecast projects with an explicit caveat', async () => {
    const forecast = (await call('forecast', { country: 'Sudan', years_ahead: 2 })) as {
      projected: { year: number; value: number }[];
      caveat: string;
    };
    expect(forecast.projected).toHaveLength(2);
    // Mock data rises 10k/year linearly → the projection continues it.
    expect(forecast.projected[1]!.value).toBeGreaterThan(forecast.projected[0]!.value);
    expect(forecast.caveat).toContain('extrapolation');
  });

  it('top_host_countries ranks descending', async () => {
    const top = (await call('top_host_countries', { year: 2024, limit: 3 })) as {
      ranking: { rank: number; country_code: string; value: number }[];
    };
    expect(top.ranking).toHaveLength(3);
    expect(top.ranking[0]!.country_code).toBe('SDN'); // largest mock base
    expect(top.ranking[0]!.value).toBeGreaterThan(top.ranking[1]!.value);
  });

  it('generate_map emits GeoJSON points for every ranked country', async () => {
    const map = (await call('generate_map', { year: 2024, limit: 4 })) as {
      feature_count: number;
      skipped_countries: string[];
      geojson: { type: string; features: { geometry: { type: string } }[] };
    };
    expect(map.geojson.type).toBe('FeatureCollection');
    expect(map.feature_count).toBe(4); // EGY, JOR, SYR, SDN all have centroids
    expect(map.skipped_countries).toEqual([]);
  });

  it('generate_chart supports all four formats', async () => {
    const base = { countries: ['Egypt'], year_from: 2020, year_to: 2023 };

    const mermaid = (await call('generate_chart', { ...base, format: 'mermaid' })) as {
      spec: string;
    };
    expect(mermaid.spec).toContain('xychart-beta');

    const svg = (await call('generate_chart', { ...base, format: 'svg', kind: 'bar' })) as {
      spec: string;
    };
    expect(svg.spec.startsWith('<svg')).toBe(true);

    const vega = (await call('generate_chart', { ...base, format: 'vega-lite' })) as {
      spec: { $schema: string };
    };
    expect(vega.spec.$schema).toContain('vega-lite');

    const chartjs = (await call('generate_chart', { ...base, format: 'chartjs' })) as {
      spec: { type: string };
    };
    expect(chartjs.spec.type).toBe('line');
  });

  it('export_data serializes json, markdown and geojson', async () => {
    const json = (await call('export_data', {
      dataset: 'population',
      format: 'json',
      country: 'Jordan',
      year_from: 2022,
      year_to: 2023,
    })) as { data: { rows: unknown[] }; row_count: number };
    expect(json.row_count).toBe(2);
    expect(json.data.rows).toHaveLength(2);

    const markdown = (await call('export_data', {
      dataset: 'population',
      format: 'markdown',
      country: 'Jordan',
      year_from: 2023,
      year_to: 2023,
    })) as { data: string };
    expect(markdown.data).toContain('| country |');

    const geojson = (await call('export_data', {
      dataset: 'population',
      format: 'geojson',
      group_by: 'asylum',
      year_from: 2024,
      year_to: 2024,
    })) as { data: { type: string } };
    expect(geojson.data.type).toBe('FeatureCollection');
  });

  it('export_data attaches a reproducible extraction manifest by default', async () => {
    const json = (await call('export_data', {
      dataset: 'population',
      format: 'json',
      country: 'Jordan',
      year_from: 2022,
      year_to: 2023,
    })) as {
      manifest: {
        tool: string;
        arguments: Record<string, unknown>;
        extracted_at: string;
        server: string;
        source: string;
        citation: string;
      };
      data: { manifest?: unknown };
    };
    expect(json.manifest.tool).toBe('export_data');
    expect(json.manifest.arguments).toMatchObject({
      dataset: 'population',
      format: 'json',
      country: 'Jordan',
      year_from: 2022,
      year_to: 2023,
    });
    expect(json.manifest.extracted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json.manifest.server).toMatch(/^humanitarian-mcp\//);
    expect(json.manifest.source).toBe('mock');
    expect(json.data.manifest).toBeDefined();

    // CSV carries the manifest as # comment lines pandas/R can skip.
    const csv = (await call('export_data', {
      dataset: 'population',
      format: 'csv',
      country: 'Jordan',
      year_from: 2023,
      year_to: 2023,
    })) as { data: string };
    expect(csv.data).toMatch(/^# humanitarian-mcp extraction manifest/);
    expect(csv.data).toContain('# citation:');

    // Opt-out keeps payloads clean.
    const bare = (await call('export_data', {
      dataset: 'population',
      format: 'csv',
      country: 'Jordan',
      year_from: 2023,
      year_to: 2023,
      include_manifest: false,
    })) as { data: string; manifest?: unknown };
    expect(bare.data).not.toContain('#');
    expect(bare.manifest).toBeUndefined();
  });

  it('export_data attaches a codebook matching the exported columns on demand', async () => {
    const result = (await call('export_data', {
      dataset: 'population',
      format: 'csv',
      country: 'Jordan',
      year_from: 2023,
      year_to: 2023,
      include_codebook: true,
    })) as { codebook: { field: string; description: string; unit: string }[] };

    const fields = result.codebook.map((entry) => entry.field);
    expect(fields).toContain('refugees');
    expect(fields).toContain('country_code');
    expect(fields).toContain('population');
    // Documents only exported columns — no IPC fields in a population export.
    expect(fields).not.toContain('ipc_phase_3plus');
    for (const entry of result.codebook) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.unit.length).toBeGreaterThan(0);
    }
  });

  it('crisis tools: conflict, food security and funding read HDX-shaped datasets', async () => {
    const conflict = (await call('conflict_events', {
      country: 'Sudan',
      year_from: 2023,
      year_to: 2024,
    })) as { records: { year: number; events: number; fatalities: number }[] };
    expect(conflict.records).toHaveLength(2);
    expect(conflict.records[0]!.fatalities).toBe(conflict.records[0]!.events * 2);

    const food = (await call('food_security', { country: 'Sudan' })) as {
      year: number;
      people_crisis_or_worse: number;
      phases: Record<string, number>;
    };
    expect(food.year).toBe(2024);
    expect(food.people_crisis_or_worse).toBe(700_000);
    expect(food.phases['ipc_phase_5']).toBe(20_000);

    const funding = (await call('humanitarian_funding', {
      country: 'Sudan',
      year_from: 2023,
      year_to: 2024,
    })) as { records: { year: number; coverage_pct?: number }[] };
    expect(funding.records.length).toBeGreaterThan(0);
    expect(funding.records[0]!.coverage_pct).toBeGreaterThan(0);
  });

  it('situation_reports pairs yearly counts with the latest report links', async () => {
    const reports = (await call('situation_reports', {
      country: 'Sudan',
      year_from: 2023,
      year_to: 2024,
    })) as {
      records: { year: number; reports: number }[];
      latest: { title: string; url: string; source: string; date: string }[];
      source: string;
    };
    expect(reports.records).toHaveLength(2);
    expect(reports.records[0]!.reports).toBe(20); // mock: 12 + (2023 − 2015)
    expect(reports.latest.length).toBeGreaterThan(0);
    expect(reports.latest[0]!.url).toMatch(/^https:\/\//);
    expect(reports.source).toBe('mock');
  });

  it('generate_chart plots normalized values with the unit on the axis', async () => {
    const chart = (await call('generate_chart', {
      countries: ['Jordan'],
      format: 'chartjs',
      normalize_by: 'population',
      year_from: 2023,
      year_to: 2024,
    })) as {
      unit: string;
      title: string;
      spec: { options: { scales: { y: { title: { text: string } } } } };
    };
    expect(chart.unit).toBe('per 1,000 residents');
    expect(chart.title).toContain('per 1,000 residents');
  });

  it('compare_countries normalizes per 1,000 residents with normalize_by', async () => {
    const result = (await call('compare_countries', {
      countries: ['Egypt', 'Jordan'],
      normalize_by: 'population',
      year_from: 2023,
      year_to: 2024,
    })) as {
      normalize_by: string;
      unit: string;
      denominator: { source: string; metric: string };
      series: { country_code: string; points: { year: number; value: number }[] }[];
    };

    expect(result.normalize_by).toBe('population');
    expect(result.unit).toBe('per 1,000 residents');
    expect(result.denominator).toMatchObject({ source: 'mock', metric: 'national_population' });

    // EGY 2024: 190,000 refugees / 110M residents × 1000 = 1.727…
    const egy = result.series.find((s) => s.country_code === 'EGY')!;
    expect(egy.points.find((p) => p.year === 2024)!.value).toBeCloseTo(1.727, 2);
    // JOR 2024: 690,000 / 11M × 1000 = 62.727…
    const jor = result.series.find((s) => s.country_code === 'JOR')!;
    expect(jor.points.find((p) => p.year === 2024)!.value).toBeCloseTo(62.727, 2);
  });

  it('top_host_countries reorders the ranking under normalize_by', async () => {
    const raw = (await call('top_host_countries', { year: 2024, limit: 4 })) as {
      ranking: { country_code: string }[];
    };
    // Absolute numbers: Sudan hosts most in the mock data.
    expect(raw.ranking[0]!.country_code).toBe('SDN');

    const normalized = (await call('top_host_countries', {
      year: 2024,
      limit: 4,
      normalize_by: 'population',
    })) as {
      unit: string;
      ranking: {
        country_code: string;
        value: number;
        raw_value?: number;
        denominator_year?: number;
      }[];
    };

    // Per 1,000 residents Jordan leads (62.7) ahead of Sudan (18.5).
    expect(normalized.unit).toBe('per 1,000 residents');
    expect(normalized.ranking.map((r) => r.country_code)).toEqual(['JOR', 'SDN', 'SYR', 'EGY']);
    expect(normalized.ranking[0]!.raw_value).toBe(690_000);
    expect(normalized.ranking[0]!.denominator_year).toBe(2024);
    expect(normalized.ranking[0]!.value).toBeCloseTo(62.727, 2);
  });

  it('get_metadata and provider_health describe the mock provider', async () => {
    const metadata = (await call('get_metadata')) as {
      providers: { id: string; datasets: unknown[] }[];
    };
    expect(metadata.providers[0]!.id).toBe('mock');
    expect(metadata.providers[0]!.datasets).toHaveLength(9);

    const health = (await call('provider_health')) as {
      healthy: boolean;
      providers: { ok: boolean }[];
    };
    expect(health.healthy).toBe(true);
    expect(health.providers[0]!.ok).toBe(true);
  });

  it('every prompt renders with a country argument', async () => {
    const withCountry = [
      'summarize_situation',
      'donor_briefing',
      'explain_trends',
      'find_anomalies',
      'executive_report',
      'infographic_summary',
    ];
    for (const name of withCountry) {
      const prompt = await client.getPrompt({ name, arguments: { country: 'Egypt' } });
      const text = (prompt.messages[0]!.content as { text: string }).text;
      expect(text, name).toContain('Egypt');
    }

    const compare = await client.getPrompt({
      name: 'compare_two_countries',
      arguments: { country_a: 'Egypt', country_b: 'Jordan' },
    });
    const text = (compare.messages[0]!.content as { text: string }).text;
    expect(text).toContain('Egypt');
    expect(text).toContain('Jordan');
  });
});
