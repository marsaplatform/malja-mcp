import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Translator } from '../i18n/index.js';
import type { CountryRef } from '../providers/types.js';
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
import { NormalizeBySchema, fetchDenominators, normalizeValue } from './denominators.js';
import type { NormalizeBy } from './denominators.js';

/**
 * Durable solutions — refugee returns, resettlement, naturalisation and IDP
 * returns from UNHCR's `/solutions/` endpoint.
 *
 * Aggregation semantics differ from `refugee_population`: these are FLOWS
 * recorded during a year, not end-year stocks. Summing across years (a
 * "period total") is therefore meaningful here and is what this tool reports;
 * it would be wrong for stocks. UNHCR's "-" (not reported) is kept distinct
 * from 0 — a metric with no reported value in any row of a year stays absent.
 */

export const SOLUTION_KEYS = [
  'returned_refugees',
  'resettlement',
  'naturalisation',
  'returned_idps',
] as const;
export type SolutionKey = (typeof SOLUTION_KEYS)[number];

export interface SolutionsYear {
  year: number;
  /** Only metrics UNHCR actually reported for the year. */
  metrics: Partial<Record<SolutionKey, number>>;
  total: number;
  total_normalized?: number;
  denominator_year?: number;
}

export interface SolutionsSummary {
  country: CountryRef;
  role: CountryRole;
  yearFrom: number;
  yearTo: number;
  years: SolutionsYear[];
  /** Sum over the period per metric (flows → summable). */
  periodTotals: Partial<Record<SolutionKey, number>>;
  periodTotal: number;
  normalizeBy: NormalizeBy;
  /** Machine-readable unit of `total_normalized` (English). */
  unit: string;
  denominatorCitation?: string;
  source: string;
  citation: string;
  truncated: boolean;
}

/** Fetch and aggregate durable-solution flows for one country and perspective. */
export async function fetchSolutions(
  ctx: AppContext,
  ref: CountryRef,
  role: CountryRole,
  range: { yearFrom: number; yearTo: number },
  options: { other?: CountryRef; normalizeBy?: NormalizeBy } = {},
): Promise<SolutionsSummary> {
  const { source, citation } = await datasetProvenance(ctx, 'solutions');
  const filter = roleFilter(role, ref.iso3);
  if (options.other) {
    Object.assign(filter, roleFilter(role === 'asylum' ? 'origin' : 'asylum', options.other.iso3));
  }
  const { records, truncated } = await fetchAllRows(ctx, {
    dataset: 'solutions',
    ...filter,
    ...range,
  });

  const years: SolutionsYear[] = aggregateByYear(records).map((aggregate) => {
    const metrics: Partial<Record<SolutionKey, number>> = {};
    for (const key of SOLUTION_KEYS) {
      const value = aggregate.metrics[key];
      if (value !== undefined) metrics[key] = value;
    }
    const total = Object.values(metrics).reduce((sum, v) => sum + v, 0);
    return { year: aggregate.year, metrics, total };
  });

  const periodTotals: Partial<Record<SolutionKey, number>> = {};
  for (const year of years) {
    for (const key of SOLUTION_KEYS) {
      const value = year.metrics[key];
      if (value !== undefined) periodTotals[key] = (periodTotals[key] ?? 0) + value;
    }
  }
  const periodTotal = years.reduce((sum, y) => sum + y.total, 0);

  const normalizeBy = options.normalizeBy ?? 'none';
  let unit = 'people';
  let denominatorCitation: string | undefined;
  if (normalizeBy !== 'none' && years.length > 0) {
    const denominators = await fetchDenominators(ctx, normalizeBy, range, [ref.iso3]);
    unit = denominators.unit;
    denominatorCitation = denominators.citation;
    for (const year of years) {
      const normalized = normalizeValue(denominators, ref.iso3, year.year, year.total);
      if (normalized) {
        year.total_normalized = Number(normalized.value.toFixed(3));
        year.denominator_year = normalized.denominator_year;
      }
    }
  }

  return {
    country: ref,
    role,
    ...range,
    years,
    periodTotals,
    periodTotal,
    normalizeBy,
    unit,
    ...(denominatorCitation ? { denominatorCitation } : {}),
    source,
    citation,
    truncated,
  };
}

/** Markdown rendering shared by the tool (and reusable by reports). */
export function solutionsMarkdown(summary: SolutionsSummary, tr: Translator): string {
  const name = tr.country(summary.country.iso3, summary.country.name);
  const kind = summary.normalizeBy === 'none' ? undefined : summary.normalizeBy;
  const normalized = kind !== undefined;
  const unitLabel = kind ? tr.unit(kind) : '';
  const headers: string[] = [...tr.m.solutions.headers];
  if (normalized) headers.push(tr.m.solutions.normalizedHeader(unitLabel));

  const rows: (string | number | null)[][] = summary.years.map((y) => {
    const row: (string | number | null)[] = [
      tr.year(y.year),
      ...SOLUTION_KEYS.map((key) => y.metrics[key] ?? null),
      y.total,
    ];
    if (normalized) row.push(y.total_normalized ?? null);
    return row;
  });
  if (summary.years.length > 1) {
    const totalRow: (string | number | null)[] = [
      `**${tr.m.solutions.periodTotal}**`,
      ...SOLUTION_KEYS.map((key) => summary.periodTotals[key] ?? null),
      summary.periodTotal,
    ];
    if (normalized) totalRow.push(null);
    rows.push(totalRow);
  }

  const parts = [
    tr.m.solutions.heading(name, tr.side(summary.role), tr.range(summary.yearFrom, summary.yearTo)),
    '',
    tr.table(headers, rows),
    '',
  ];

  if (summary.periodTotal > 0) {
    const mix = SOLUTION_KEYS.filter((key) => (summary.periodTotals[key] ?? 0) > 0).map(
      (key) =>
        `${tr.m.solutions.headers[SOLUTION_KEYS.indexOf(key) + 1]!} ${tr.pct(((summary.periodTotals[key] ?? 0) / summary.periodTotal) * 100)}`,
    );
    parts.push(tr.m.solutions.mixLine(mix.join(tr.m.meta.dotSeparator)), '');
  }

  parts.push(tr.m.solutions.perspective[summary.role](name), '', tr.m.solutions.flowNote);
  if (kind && summary.denominatorCitation) {
    parts.push(
      tr.m.denominators
        .valuesNote(unitLabel, tr.m.denominators.kind[kind], summary.denominatorCitation)
        .trimStart(),
    );
  }
  if (summary.truncated) parts.push(tr.m.common.truncatedNote.trimStart());
  parts.push('', tr.sourceLine(summary.citation, summary.source));
  return parts.join('\n');
}

const SolutionMetricsSchema = z.object({
  returned_refugees: z.number().optional(),
  resettlement: z.number().optional(),
  naturalisation: z.number().optional(),
  returned_idps: z.number().optional(),
});

export function registerSolutionsTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'durable_solutions',
    {
      title: 'Durable solutions',
      description:
        'UNHCR durable solutions per year: refugee returns, resettlement, naturalisation and IDP returns. These are FLOWS during each year (not end-year stocks), so a period total is reported. role "origin" (default) = solutions for people FROM the country (returns home, resettled/naturalised abroad); role "asylum" = refugees who left the country to return home, people resettled TO it, naturalised IN it. Optional other_country cross-filter and normalize_by ("population" → per 1,000 residents of the country).',
      inputSchema: {
        country: countryInput,
        role: CountryRoleSchema.optional().describe(
          '"origin" (default) = solutions for people from the country; "asylum" = solutions in / departures from the country as host or resettlement country',
        ),
        other_country: z
          .string()
          .optional()
          .describe(
            'Optional second country for the opposite role, e.g. country="Syria", other_country="Lebanon" → Syrians returning from Lebanon',
          ),
        year_from: yearFromInput,
        year_to: yearToInput,
        normalize_by: NormalizeBySchema.optional(),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        role: z.string(),
        year_from: z.number(),
        year_to: z.number(),
        measure: z.literal('flow'),
        years: z.array(
          z.object({
            year: z.number(),
            metrics: SolutionMetricsSchema,
            total: z.number(),
            total_normalized: z.number().optional(),
            denominator_year: z.number().optional(),
          }),
        ),
        period_totals: SolutionMetricsSchema,
        period_total: z.number(),
        normalize_by: z.string(),
        unit: z.string(),
        source: z.string(),
      },
    },
    async ({ country, role, other_country, year_from, year_to, normalize_by }, _extra, tr) => {
      const chosenRole = role ?? 'origin';
      const ref = await resolveCountry(ctx, country);
      const range = defaultYearRange(year_from, year_to);
      const other = other_country ? await resolveCountry(ctx, other_country) : undefined;
      const summary = await fetchSolutions(ctx, ref, chosenRole, range, {
        ...(other ? { other } : {}),
        normalizeBy: normalize_by ?? 'none',
      });

      if (summary.years.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.solutions.noData(
                tr.country(ref.iso3, ref.name),
                tr.side(chosenRole),
                tr.range(range.yearFrom, range.yearTo),
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: solutionsMarkdown(summary, tr) }],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          role: chosenRole,
          year_from: range.yearFrom,
          year_to: range.yearTo,
          measure: 'flow',
          years: summary.years,
          period_totals: summary.periodTotals,
          period_total: summary.periodTotal,
          normalize_by: summary.normalizeBy,
          unit: summary.unit,
          source: summary.source,
        },
      };
    },
  );
}
