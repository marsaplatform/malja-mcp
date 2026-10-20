import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { defineTool } from './common.js';

export function registerMetaTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'get_metadata',
    {
      title: 'Get metadata',
      description:
        'Describe the connected data providers: datasets served, metrics available, attribution and terms. Call this to learn what data exists before querying.',
      inputSchema: {},
      outputSchema: {
        providers: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            homepage: z.string(),
            attribution: z.string(),
            terms: z.string(),
            datasets: z.array(
              z.object({
                id: z.string(),
                title: z.string(),
                description: z.string(),
                metrics: z.array(z.string()),
                citation: z.string(),
              }),
            ),
          }),
        ),
      },
    },
    async (_args, _extra, tr) => {
      const providers = await Promise.all(ctx.registry.all().map((p) => p.metadata()));
      // Provider descriptions/attributions are the producers' own wording and
      // stay as published; dataset ids and metric keys stay verbatim (they
      // are tool parameters). Localized locales add a translated dataset title.
      const english = tr.locale === 'en';
      const lines = providers.map((p) => {
        const datasets = tr.table(
          tr.m.metadata.headers,
          p.datasets.map((d) => [
            english ? d.id : `${tr.dataset(d.id)} (\`${d.id}\`)`,
            d.metrics.join(', '),
            d.description,
          ]),
        );
        const producer = tr.producer(p.id);
        return `## ${producer || p.name} (\`${p.id}\`)\n\n${p.description}\n\n${datasets}\n\n_${p.attribution}_`;
      });
      return {
        content: [{ type: 'text', text: lines.join('\n\n') }],
        structuredContent: {
          providers: providers.map((p) => ({
            ...p,
            datasets: p.datasets.map((d) => ({ ...d, metrics: [...d.metrics] })),
          })),
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'provider_health',
    {
      title: 'Provider health',
      description:
        'Liveness check of every connected data provider (latency, reachability). Use when queries fail to distinguish upstream outages from bad parameters.',
      inputSchema: {},
      outputSchema: {
        healthy: z.boolean(),
        providers: z.array(
          z.object({
            provider: z.string(),
            ok: z.boolean(),
            latencyMs: z.number().optional(),
            detail: z.string(),
            checkedAt: z.string(),
          }),
        ),
      },
    },
    async (_args, _extra, tr) => {
      const results = await Promise.all(ctx.registry.all().map((p) => p.health()));
      const table = tr.table(
        tr.m.metadata.healthHeaders,
        results.map((r) => [
          r.provider,
          r.ok ? tr.m.metadata.ok : tr.m.metadata.down,
          r.latencyMs !== undefined ? tr.m.metadata.ms(tr.num(r.latencyMs)) : '—',
          r.detail,
        ]),
      );
      return {
        content: [{ type: 'text', text: table }],
        structuredContent: { healthy: results.every((r) => r.ok), providers: results },
      };
    },
  );
}
