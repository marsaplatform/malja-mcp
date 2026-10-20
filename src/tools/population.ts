import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  CountryRoleSchema,
  NormalizedRecordSchema,
  PageInfoSchema,
  countryInput,
  yearFromInput,
  yearToInput,
} from '../schemas/common.js';
import {
  datasetProvenance,
  defaultYearRange,
  defineTool,
  latestAggregates,
  resolveCountry,
  roleFilter,
} from './common.js';

export function registerPopulationTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'refugee_population',
    {
      title: 'Refugee population',
      description:
        'Yearly displacement figures for a country: refugees, asylum-seekers, IDPs, stateless and others. role "asylum" (default) = hosted in the country; role "origin" = displaced from it. Optionally cross-filter by a second country (e.g. Syrians hosted in Egypt). Paginated.',
      inputSchema: {
        country: countryInput,
        role: CountryRoleSchema.optional(),
        other_country: z
          .string()
          .optional()
          .describe(
            'Optional second country for the opposite role, e.g. country="Egypt", role="asylum", other_country="Syria" → Syrians in Egypt',
          ),
        year_from: yearFromInput,
        year_to: yearToInput,
        page: z.number().int().min(1).optional().describe('1-based page (default 1)'),
        limit: z.number().int().min(1).max(1000).optional().describe('Rows per page (default 100)'),
      },
      outputSchema: {
        records: z.array(NormalizedRecordSchema),
        page_info: PageInfoSchema,
        source: z.string(),
      },
    },
    async ({ country, role, other_country, year_from, year_to, page, limit }, _extra, tr) => {
      const chosenRole = role ?? 'asylum';
      const ref = await resolveCountry(ctx, country);
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'population');

      const filter = roleFilter(chosenRole, ref.iso3);
      if (other_country) {
        const other = await resolveCountry(ctx, other_country);
        Object.assign(
          filter,
          roleFilter(chosenRole === 'asylum' ? 'origin' : 'asylum', other.iso3),
        );
      }

      const provider = await ctx.registry.forDataset('population');
      const result = await provider.list({
        dataset: 'population',
        ...filter,
        yearFrom,
        yearTo,
        page: page ?? 1,
        limit: limit ?? 100,
      });

      const table = tr.table(
        tr.m.population.headers,
        result.items.map((r) => [
          tr.year(r.year),
          r.metrics['refugees'] ?? null,
          r.metrics['asylum_seekers'] ?? null,
          r.metrics['idps'] ?? null,
          r.metrics['stateless'] ?? null,
          r.population,
        ]),
      );

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.population.heading(tr.country(ref.iso3, ref.name), tr.side(chosenRole), tr.range(yearFrom, yearTo))}\n\n${table}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          records: result.items,
          page_info: {
            page: result.page,
            ...(result.maxPages !== undefined ? { maxPages: result.maxPages } : {}),
            ...(result.total !== undefined ? { total: result.total } : {}),
          },
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'demographics',
    {
      title: 'Demographics',
      description:
        'Latest age/sex breakdown of displaced people connected to a country (role "asylum" = hosted there, default; "origin" = from there). UNHCR publishes demographics for recent years only.',
      inputSchema: {
        country: countryInput,
        role: CountryRoleSchema.optional(),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        year: z.number(),
        female: z.record(z.number()),
        male: z.record(z.number()),
        total: z.number(),
        source: z.string(),
      },
    },
    async ({ country, role }, _extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const name = tr.country(ref.iso3, ref.name);
      const chosenRole = role ?? 'asylum';
      const { source, citation } = await datasetProvenance(ctx, 'demographics');
      const aggregate = await latestAggregates(
        ctx,
        'demographics',
        roleFilter(chosenRole, ref.iso3),
      );
      if (!aggregate) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.demographics.noData(name, chosenRole),
            },
          ],
          isError: true,
        };
      }

      const buckets = ['0_4', '5_11', '12_17', '18_59', '60'] as const;
      const female: Record<string, number> = {};
      const male: Record<string, number> = {};
      for (const bucket of buckets) {
        female[bucket] = aggregate.metrics[`f_${bucket}`] ?? 0;
        male[bucket] = aggregate.metrics[`m_${bucket}`] ?? 0;
      }
      const total = aggregate.metrics['total'] ?? aggregate.population;
      const fTotal = aggregate.metrics['f_total'] ?? 0;
      const mTotal = aggregate.metrics['m_total'] ?? 0;

      const table = tr.table(
        tr.m.demographics.headers,
        buckets.map((bucket) => {
          const rowTotal = (female[bucket] ?? 0) + (male[bucket] ?? 0);
          return [
            tr.text(tr.m.demographics.age[bucket] ?? bucket),
            female[bucket] ?? 0,
            male[bucket] ?? 0,
            total > 0 ? tr.pct((rowTotal / total) * 100) : '—',
          ];
        }),
      );

      const pctFemale = total > 0 ? tr.pct((fTotal / total) * 100) : '—';
      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.demographics.heading(name, tr.side(chosenRole), tr.year(aggregate.year))}\n\n${table}\n\n${tr.m.demographics.totalLine(tr.num(total), pctFemale)}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          year: aggregate.year,
          female: { ...female, total: fTotal },
          male: { ...male, total: mTotal },
          total,
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'latest_statistics',
    {
      title: 'Latest statistics',
      description:
        'Most recent displacement figures. With a country: its latest hosted figures. Without: the latest global totals.',
      inputSchema: {
        country: z.string().optional().describe('Country name or ISO3; omit for global totals'),
        role: CountryRoleSchema.optional(),
      },
      outputSchema: {
        scope: z.string(),
        year: z.number(),
        figures: z.record(z.number()),
        source: z.string(),
      },
    },
    async ({ country, role }, _extra, tr) => {
      const chosenRole = role ?? 'asylum';
      const { source, citation } = await datasetProvenance(ctx, 'population');
      let scope = 'Global';
      let scopeLabel = tr.m.latest.global;
      let filter = {};
      if (country) {
        const ref = await resolveCountry(ctx, country);
        scope = ref.name;
        scopeLabel = tr.country(ref.iso3, ref.name);
        filter = roleFilter(chosenRole, ref.iso3);
      }

      const aggregate = await latestAggregates(ctx, 'population', filter);
      if (!aggregate) {
        return {
          content: [{ type: 'text', text: tr.m.latest.noData(scopeLabel) }],
          isError: true,
        };
      }

      const table = tr.table(
        [tr.m.common.indicator, tr.m.common.people],
        Object.entries(aggregate.metrics).map(([k, v]) => [tr.metric(k), v]),
      );
      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.latest.heading(scopeLabel, country ? tr.side(chosenRole) : '', tr.year(aggregate.year))}\n\n${table}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          scope,
          year: aggregate.year,
          figures: aggregate.metrics,
          source,
        },
      };
    },
  );
}
