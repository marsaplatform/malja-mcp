import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { countryInput, yearFromInput, yearToInput } from '../schemas/common.js';
import {
  aggregateByYear,
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  resolveCountry,
} from './common.js';

/**
 * Crisis-context tools: conflict events (ACLED), food security (IPC),
 * humanitarian funding (OCHA FTS) and situation reports (ReliefWeb).
 * Provider-agnostic like every other tool — they ask the registry for
 * whoever serves the dataset and surface the original source's citation.
 */

export function registerCrisisTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'conflict_events',
    {
      title: 'Conflict events',
      description:
        'Annual conflict event counts and fatalities for a country (ACLED via HDX). Pairs with refugee_population/trend_analysis to relate violence and displacement.',
      inputSchema: {
        country: countryInput,
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        records: z.array(
          z.object({ year: z.number(), events: z.number(), fatalities: z.number() }),
        ),
        source: z.string(),
      },
    },
    async ({ country, year_from, year_to }, _extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const name = tr.country(ref.iso3, ref.name);
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'conflict-events');

      const { records } = await fetchAllRows(ctx, {
        dataset: 'conflict-events',
        asylum_iso3: ref.iso3,
        yearFrom,
        yearTo,
      });
      const rows = aggregateByYear(records).map((aggregate) => ({
        year: aggregate.year,
        events: aggregate.metrics['events'] ?? 0,
        fatalities: aggregate.metrics['fatalities'] ?? 0,
      }));

      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.crisis.conflictNoData(name, tr.range(yearFrom, yearTo)),
            },
          ],
          isError: true,
        };
      }

      const table = tr.table(
        tr.m.crisis.conflictHeaders,
        rows.map((r) => [tr.year(r.year), r.events, r.fatalities]),
      );
      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.crisis.conflictHeading(name, tr.range(yearFrom, yearTo))}\n\n${table}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          records: rows,
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'food_security',
    {
      title: 'Food security (IPC)',
      description:
        'Latest IPC food-insecurity phase breakdown for a country: people per phase 1–5, with phase 3+ ("crisis or worse") as the headline. Data: IPC via HDX.',
      inputSchema: {
        country: countryInput,
        year: z
          .number()
          .int()
          .min(2000)
          .optional()
          .describe('Analysis year (default: latest available)'),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        year: z.number(),
        phases: z.record(z.number()),
        people_crisis_or_worse: z.number(),
        source: z.string(),
      },
    },
    async ({ country, year }, _extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const name = tr.country(ref.iso3, ref.name);
      const { source, citation } = await datasetProvenance(ctx, 'food-security');

      const { records } = await fetchAllRows(ctx, {
        dataset: 'food-security',
        asylum_iso3: ref.iso3,
        ...(year !== undefined ? { yearFrom: year, yearTo: year } : {}),
      });
      const latest = records.sort((a, b) => a.year - b.year).at(-1);
      if (!latest) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.crisis.foodNoData(name, year ? tr.year(year) : undefined),
            },
          ],
          isError: true,
        };
      }

      const phaseKeys = ['ipc_phase_1', 'ipc_phase_2', 'ipc_phase_3', 'ipc_phase_4', 'ipc_phase_5'];
      const table = tr.table(
        [tr.m.crisis.ipcPhase, tr.m.common.people],
        phaseKeys
          .filter((key) => latest.metrics[key] !== undefined)
          .map((key) => [tr.text(tr.m.crisis.ipcPhases[key] ?? key), latest.metrics[key] ?? 0]),
      );

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.crisis.foodHeading(name, tr.year(latest.year))}\n\n${table}\n\n${tr.text(tr.m.crisis.crisisOrWorse(tr.num(latest.population)))}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          year: latest.year,
          phases: latest.metrics,
          people_crisis_or_worse: latest.population,
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'humanitarian_funding',
    {
      title: 'Humanitarian funding',
      description:
        'Humanitarian appeal requirements vs funding received per year for a country, with coverage percentage (OCHA FTS via HDX).',
      inputSchema: {
        country: countryInput,
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        records: z.array(
          z.object({
            year: z.number(),
            requirements_usd: z.number(),
            funding_usd: z.number(),
            coverage_pct: z.number().optional(),
          }),
        ),
        source: z.string(),
      },
    },
    async ({ country, year_from, year_to }, _extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const name = tr.country(ref.iso3, ref.name);
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'humanitarian-funding');

      const { records } = await fetchAllRows(ctx, {
        dataset: 'humanitarian-funding',
        asylum_iso3: ref.iso3,
        yearFrom,
        yearTo,
      });
      const rows = aggregateByYear(records).map((aggregate) => {
        const requirements = aggregate.metrics['requirements_usd'] ?? 0;
        const funding = aggregate.metrics['funding_usd'] ?? 0;
        return {
          year: aggregate.year,
          requirements_usd: requirements,
          funding_usd: funding,
          ...(requirements > 0
            ? { coverage_pct: Number(((funding / requirements) * 100).toFixed(1)) }
            : {}),
        };
      });

      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.crisis.fundingNoData(name, tr.range(yearFrom, yearTo)),
            },
          ],
          isError: true,
        };
      }

      const table = tr.table(
        tr.m.crisis.fundingHeaders,
        rows.map((r) => [
          tr.year(r.year),
          r.requirements_usd,
          r.funding_usd,
          r.coverage_pct !== undefined ? tr.text(`${r.coverage_pct}%`) : '—',
        ]),
      );
      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.crisis.fundingHeading(name, tr.range(yearFrom, yearTo))}\n\n${table}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          records: rows,
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'situation_reports',
    {
      title: 'Situation reports',
      description:
        'Situation reports published about a country: yearly counts plus the most recent report titles and links (ReliefWeb). Use it to ground trends and anomalies from other tools in what was actually reported at the time.',
      inputSchema: {
        country: countryInput,
        year_from: yearFromInput,
        year_to: yearToInput,
        query: z
          .string()
          .optional()
          .describe(
            'Free-text filter for the listed reports (e.g. "cholera") — yearly counts stay unfiltered',
          ),
        max_reports: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('How many of the most recent reports to list (default 5)'),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        records: z.array(z.object({ year: z.number(), reports: z.number() })),
        latest: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            source: z.string(),
            date: z.string(),
          }),
        ),
        source: z.string(),
      },
    },
    async ({ country, year_from, year_to, query, max_reports }, _extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const name = tr.country(ref.iso3, ref.name);
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'situation-reports');

      const provider = await ctx.registry.forDataset('situation-reports');
      const [{ records }, documents] = await Promise.all([
        fetchAllRows(ctx, {
          dataset: 'situation-reports',
          asylum_iso3: ref.iso3,
          yearFrom,
          yearTo,
        }),
        provider.documents
          ? provider.documents({
              iso3: ref.iso3,
              ...(query !== undefined ? { query } : {}),
              yearFrom,
              yearTo,
              limit: max_reports ?? 5,
            })
          : Promise.resolve([]),
      ]);

      const rows = aggregateByYear(records).map((aggregate) => ({
        year: aggregate.year,
        reports: aggregate.metrics['reports'] ?? aggregate.population,
      }));

      if (rows.length === 0 && documents.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.crisis.reportsNoData(name, tr.range(yearFrom, yearTo)),
            },
          ],
          isError: true,
        };
      }

      const table = tr.table(
        [tr.m.common.year, tr.m.crisis.reportsHeader],
        rows.map((r) => [tr.year(r.year), r.reports]),
      );
      const latest = documents.map((d) => ({
        title: d.title,
        url: d.url,
        source: d.source,
        date: d.date,
      }));
      const latestList = latest
        .map(
          (d) =>
            `- ${tr.text(d.date.slice(0, 10)) || tr.m.crisis.undated} — [${d.title}](${d.url})${d.source ? ` (${d.source})` : ''}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.crisis.reportsHeading(name, tr.range(yearFrom, yearTo))}\n\n${table}\n\n${tr.m.crisis.latestReports(query)}\n\n${latestList || tr.m.crisis.noneInRange}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          records: rows,
          latest,
          source,
        },
      };
    },
  );
}
