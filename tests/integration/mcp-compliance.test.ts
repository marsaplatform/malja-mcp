import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SERVER_NAME, SERVER_VERSION } from '../../src/config.js';
import { NormalizedRecordSchema } from '../../src/schemas/common.js';
import { createServer } from '../../src/server.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * MCP compliance suite: drives the real server through the official SDK
 * client over an in-memory transport — exactly what Claude Desktop or any
 * other MCP client sees, minus the pipe.
 */

const EXPECTED_TOOLS = [
  'search_country',
  'country_profile',
  'compare_countries',
  'refugee_population',
  'demographics',
  'latest_statistics',
  'asylum_applications',
  'asylum_decisions',
  'conflict_events',
  'food_security',
  'humanitarian_funding',
  'situation_reports',
  'trend_analysis',
  'forecast',
  'top_host_countries',
  'generate_chart',
  'generate_map',
  'generate_country_report',
  'export_data',
  'get_metadata',
  'provider_health',
];

const EXPECTED_PROMPTS = [
  'summarize_situation',
  'compare_two_countries',
  'donor_briefing',
  'explain_trends',
  'find_anomalies',
  'executive_report',
  'infographic_summary',
  'crisis_overview',
];

describe('MCP compliance', () => {
  const ctx = buildTestContext();
  const server = createServer(ctx);
  const client = new Client({ name: 'compliance-suite', version: '1.0.0' });

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('negotiates initialization with server info and instructions', () => {
    expect(client.getServerVersion()).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    expect(client.getInstructions()).toContain('role="asylum"');
  });

  it('lists every tool with a description and input schema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object' });
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it('search_country returns structured matches', async () => {
    const result = await client.callTool({
      name: 'search_country',
      arguments: { query: 'egypt' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { matches: { iso3: string; score: number }[] };
    expect(structured.matches[0]).toMatchObject({ iso3: 'EGY', score: 1 });
  });

  it('refugee_population returns records matching the normalized schema', async () => {
    const result = await client.callTool({
      name: 'refugee_population',
      arguments: { country: 'Jordan', year_from: 2020, year_to: 2023 },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      records: unknown[];
      page_info: { page: number };
    };
    expect(structured.records.length).toBe(4);
    for (const record of structured.records) {
      expect(() => NormalizedRecordSchema.parse(record)).not.toThrow();
    }
    expect(structured.page_info.page).toBe(1);
  });

  it('paginates refugee_population', async () => {
    const result = await client.callTool({
      name: 'refugee_population',
      arguments: { country: 'Jordan', year_from: 2020, year_to: 2023, limit: 2, page: 2 },
    });
    const structured = result.structuredContent as {
      records: { year: number }[];
      page_info: { page: number; maxPages: number };
    };
    expect(structured.page_info).toMatchObject({ page: 2, maxPages: 2 });
    expect(structured.records.map((r) => r.year)).toEqual([2022, 2023]);
  });

  it('compare_countries aligns series across countries', async () => {
    const result = await client.callTool({
      name: 'compare_countries',
      arguments: { countries: ['Egypt', 'Jordan'], year_from: 2020, year_to: 2022 },
    });
    const structured = result.structuredContent as {
      series: { country: string; points: { year: number; value: number }[] }[];
    };
    expect(structured.series).toHaveLength(2);
    expect(structured.series[0]!.points).toHaveLength(3);
  });

  it('trend_analysis reports a direction for a monotone series', async () => {
    const result = await client.callTool({
      name: 'trend_analysis',
      arguments: { country: 'Sudan', year_from: 2016, year_to: 2024 },
    });
    const structured = result.structuredContent as { trend: { direction: string; r2: number } };
    expect(structured.trend.direction).toBe('increasing');
    expect(structured.trend.r2).toBeCloseTo(1);
  });

  it('export_data produces parseable CSV', async () => {
    const result = await client.callTool({
      name: 'export_data',
      arguments: {
        dataset: 'population',
        format: 'csv',
        country: 'Egypt',
        year_from: 2022,
        year_to: 2023,
      },
    });
    const structured = result.structuredContent as { data: string; row_count: number };
    expect(structured.row_count).toBe(2);
    const [header, first] = structured.data.split('\r\n');
    expect(header).toContain('country,country_code,');
    expect(first).toContain('Egypt,EGY,2022');
  });

  it('generate_chart emits a valid chartjs config as structured content', async () => {
    const result = await client.callTool({
      name: 'generate_chart',
      arguments: { countries: ['Egypt'], format: 'chartjs', year_from: 2020, year_to: 2023 },
    });
    const structured = result.structuredContent as {
      format: string;
      spec: { type: string; data: { datasets: unknown[] } };
    };
    expect(structured.format).toBe('chartjs');
    expect(structured.spec.type).toBe('line');
    expect(structured.spec.data.datasets).toHaveLength(1);
  });

  it('unknown countries produce isError results with actionable text, not protocol errors', async () => {
    const result = await client.callTool({
      name: 'country_profile',
      arguments: { country: 'Atlantis' },
    });
    expect(result.isError).toBe(true);
    const [content] = result.content as { type: string; text: string }[];
    expect(content!.text).toContain('search_country');
  });

  it('rejects invalid arguments via schema validation', async () => {
    const result = await client.callTool({
      name: 'compare_countries',
      arguments: { countries: ['only-one'] },
    });
    expect(result.isError).toBe(true);
    const [content] = result.content as { text: string }[];
    expect(content!.text).toContain('at least 2');
  });

  it('lists static resources and resource templates', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        'metadata://providers',
        'metadata://countries',
        'metadata://datasets',
        'dataset://population',
      ]),
    );

    const { resourceTemplates } = await client.listResourceTemplates();
    const templates = resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toEqual(
      expect.arrayContaining(['country://{code}', 'report://{code}', 'chart://{code}']),
    );
  });

  it('reads metadata://providers as JSON', async () => {
    const { contents } = await client.readResource({ uri: 'metadata://providers' });
    const providers = JSON.parse((contents[0] as { text: string }).text) as { id: string }[];
    expect(providers[0]!.id).toBe('mock');
  });

  it('reads a templated country resource', async () => {
    const { contents } = await client.readResource({ uri: 'country://EGY' });
    const snapshot = JSON.parse((contents[0] as { text: string }).text) as {
      country_code: string;
      hosted: Record<string, number>;
    };
    expect(snapshot.country_code).toBe('EGY');
    expect(snapshot.hosted['refugees']).toBeGreaterThan(0);
  });

  it('reads a templated markdown report resource', async () => {
    const { contents } = await client.readResource({ uri: 'report://JOR' });
    const content = contents[0] as { mimeType?: string; text: string };
    expect(content.mimeType).toBe('text/markdown');
    expect(content.text).toContain('# Jordan — Humanitarian Situation Report');
    expect(content.text).toContain('```mermaid');
  });

  it('lists and renders prompts', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...EXPECTED_PROMPTS].sort());

    const prompt = await client.getPrompt({
      name: 'donor_briefing',
      arguments: { country: 'Sudan', audience: 'institutional donors' },
    });
    const message = prompt.messages[0]!;
    expect(message.role).toBe('user');
    const text = (message.content as { text: string }).text;
    expect(text).toContain('Sudan');
    expect(text).toContain('institutional donors');
  });

  it('reports progress notifications during generate_country_report', async () => {
    const progressMessages: string[] = [];
    const result = await client.callTool(
      { name: 'generate_country_report', arguments: { country: 'Egypt' } },
      undefined,
      {
        onprogress: (progress) => {
          if (progress.message) progressMessages.push(progress.message);
        },
      },
    );
    expect(result.isError).toBeFalsy();
    expect(progressMessages.length).toBeGreaterThanOrEqual(3);
    expect(progressMessages).toContain('Composing report');

    const structured = result.structuredContent as { markdown: string };
    expect(structured.markdown).toContain('Humanitarian Situation Report');
  });

  it('records analytics for the dashboard', () => {
    const snapshot = ctx.analytics.snapshot();
    expect(snapshot.totalCalls).toBeGreaterThan(5);
    expect(z.array(z.object({ tool: z.string() })).parse(snapshot.tools)).toBeTruthy();
  });
});
