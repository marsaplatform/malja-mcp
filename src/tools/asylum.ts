import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { CountryRoleSchema, countryInput, yearFromInput, yearToInput } from '../schemas/common.js';
import {
  aggregateByYear,
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  resolveCountry,
  roleFilter,
} from './common.js';
import type { CountryRole } from './common.js';

async function yearlyAggregates(
  ctx: AppContext,
  dataset: 'asylum-applications' | 'asylum-decisions',
  country: string,
  role: CountryRole,
  year_from: number | undefined,
  year_to: number | undefined,
) {
  const ref = await resolveCountry(ctx, country);
  const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
  const { records, truncated } = await fetchAllRows(ctx, {
    dataset,
    ...roleFilter(role, ref.iso3),
    yearFrom,
    yearTo,
  });
  return { ref, yearFrom, yearTo, aggregates: aggregateByYear(records), truncated };
}

export function registerAsylumTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'asylum_applications',
    {
      title: 'Asylum applications',
      description:
        'Individual asylum applications lodged per year. role "asylum" (default) = applications filed IN the country; "origin" = filed BY nationals of the country abroad.',
      inputSchema: {
        country: countryInput,
        role: CountryRoleSchema.optional(),
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        role: z.string(),
        yearly: z.array(z.object({ year: z.number(), applied: z.number() })),
        source: z.string(),
      },
    },
    async ({ country, role, year_from, year_to }, _extra, tr) => {
      const chosenRole = role ?? 'asylum';
      const { source, citation } = await datasetProvenance(ctx, 'asylum-applications');
      const { ref, yearFrom, yearTo, aggregates, truncated } = await yearlyAggregates(
        ctx,
        'asylum-applications',
        country,
        chosenRole,
        year_from,
        year_to,
      );

      const yearly = aggregates.map((a) => ({ year: a.year, applied: a.metrics['applied'] ?? 0 }));
      const table = tr.table(
        [tr.m.common.year, tr.m.asylum.applications],
        yearly.map((y) => [tr.year(y.year), y.applied]),
      );
      const note = truncated ? tr.m.common.truncatedNote : '';

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.asylum.applicationsHeading(tr.country(ref.iso3, ref.name), tr.side(chosenRole), tr.range(yearFrom, yearTo))}\n\n${table}${note}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          role: chosenRole,
          yearly,
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'asylum_decisions',
    {
      title: 'Asylum decisions',
      description:
        'Decisions on individual asylum applications per year — recognized, complementary protection, rejected, otherwise closed — plus the recognition rate. role "asylum" (default) = decided IN the country.',
      inputSchema: {
        country: countryInput,
        role: CountryRoleSchema.optional(),
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        role: z.string(),
        yearly: z.array(
          z.object({
            year: z.number(),
            recognized: z.number(),
            complementary: z.number(),
            rejected: z.number(),
            closed: z.number(),
            total: z.number(),
            recognition_rate_pct: z.number().nullable(),
          }),
        ),
        source: z.string(),
      },
    },
    async ({ country, role, year_from, year_to }, _extra, tr) => {
      const chosenRole = role ?? 'asylum';
      const { source, citation } = await datasetProvenance(ctx, 'asylum-decisions');
      const { ref, yearFrom, yearTo, aggregates, truncated } = await yearlyAggregates(
        ctx,
        'asylum-decisions',
        country,
        chosenRole,
        year_from,
        year_to,
      );

      const yearly = aggregates.map((a) => {
        const recognized = a.metrics['dec_recognized'] ?? 0;
        const complementary = a.metrics['dec_other'] ?? 0;
        const rejected = a.metrics['dec_rejected'] ?? 0;
        const closed = a.metrics['dec_closed'] ?? 0;
        const total = a.metrics['dec_total'] ?? recognized + complementary + rejected + closed;
        const substantive = recognized + complementary + rejected;
        return {
          year: a.year,
          recognized,
          complementary,
          rejected,
          closed,
          total,
          recognition_rate_pct:
            substantive > 0
              ? Math.round(((recognized + complementary) / substantive) * 1000) / 10
              : null,
        };
      });

      const table = tr.table(
        tr.m.asylum.decisionHeaders,
        yearly.map((y) => [
          tr.year(y.year),
          y.recognized,
          y.complementary,
          y.rejected,
          y.closed,
          y.total,
          y.recognition_rate_pct !== null ? tr.text(`${y.recognition_rate_pct}%`) : '—',
        ]),
      );
      const note = truncated ? tr.m.common.truncatedNote : '';

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.asylum.decisionsHeading(tr.country(ref.iso3, ref.name), tr.side(chosenRole), tr.range(yearFrom, yearTo))}\n\n${table}${note}\n\n${tr.m.asylum.recognitionNote(citation, tr.producer(source))}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          role: chosenRole,
          yearly,
          source,
        },
      };
    },
  );
}
