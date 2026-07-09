import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { countryInput, yearFromInput, yearToInput } from '../schemas/common.js';
import { formatNumber, markdownTable } from '../viz/table.js';
import {
  aggregateByYear,
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  resolveCountry,
} from './common.js';

/**
 * Crisis-context tools over the HDX/HAPI datasets: conflict events (ACLED),
 * food security (IPC) and humanitarian funding (OCHA FTS). Provider-agnostic
 * like every other tool — they ask the registry for whoever serves the
 * dataset and surface the original source's citation.
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
    async ({ country, year_from, year_to }) => {
      const ref = await resolveCountry(ctx, country);
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
              text: `No conflict-event data for ${ref.name} in ${yearFrom}–${yearTo}. Coverage follows ACLED via HDX; try a wider year range.`,
            },
          ],
          isError: true,
        };
      }

      const table = markdownTable(
        ['Year', 'Events', 'Fatalities'],
        rows.map((r) => [String(r.year), r.events, r.fatalities]),
      );
      return {
        content: [
          {
            type: 'text',
            text: `Conflict events — **${ref.name}**, ${yearFrom}–${yearTo}\n\n${table}\n\n_Source: ${citation}_`,
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
    async ({ country, year }) => {
      const ref = await resolveCountry(ctx, country);
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
              text: `No IPC food-security data for ${ref.name}${year ? ` in ${year}` : ''}. IPC covers countries with active analyses only.`,
            },
          ],
          isError: true,
        };
      }

      const phaseLabels: [string, string][] = [
        ['ipc_phase_1', 'Phase 1 — minimal'],
        ['ipc_phase_2', 'Phase 2 — stressed'],
        ['ipc_phase_3', 'Phase 3 — crisis'],
        ['ipc_phase_4', 'Phase 4 — emergency'],
        ['ipc_phase_5', 'Phase 5 — catastrophe'],
      ];
      const table = markdownTable(
        ['IPC phase', 'People'],
        phaseLabels
          .filter(([key]) => latest.metrics[key] !== undefined)
          .map(([key, label]) => [label, latest.metrics[key] ?? 0]),
      );

      return {
        content: [
          {
            type: 'text',
            text: `Food security — **${ref.name}**, ${latest.year}\n\n${table}\n\nIn crisis or worse (IPC 3+): **${formatNumber(latest.population)}**\n\n_Source: ${citation}_`,
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
    async ({ country, year_from, year_to }) => {
      const ref = await resolveCountry(ctx, country);
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
              text: `No humanitarian funding data for ${ref.name} in ${yearFrom}–${yearTo}. FTS tracks countries with coordinated appeals.`,
            },
          ],
          isError: true,
        };
      }

      const table = markdownTable(
        ['Year', 'Required (US$)', 'Funded (US$)', 'Coverage'],
        rows.map((r) => [
          String(r.year),
          r.requirements_usd,
          r.funding_usd,
          r.coverage_pct !== undefined ? `${r.coverage_pct}%` : '—',
        ]),
      );
      return {
        content: [
          {
            type: 'text',
            text: `Humanitarian funding — **${ref.name}**, ${yearFrom}–${yearTo}\n\n${table}\n\n_Source: ${citation}_`,
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
}
