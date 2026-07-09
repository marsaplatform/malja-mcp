import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  CountryRoleSchema,
  YearValueSchema,
  countryInput,
  yearFromInput,
  yearToInput,
} from '../schemas/common.js';
import {
  cagr,
  detectAnomalies,
  forecastLinear,
  linearRegression,
  yearOverYear,
} from '../shared/stats.js';
import { formatNumber, markdownTable } from '../viz/table.js';
import {
  aggregateByYear,
  currentYear,
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  metricSeries,
  resolveCountry,
  roleFilter,
} from './common.js';
import type { CountryRole } from './common.js';
import { NormalizeBySchema, fetchDenominators, normalizeValue } from './denominators.js';

async function countrySeries(
  ctx: AppContext,
  country: string,
  role: CountryRole,
  metric: string,
  yearFrom: number,
  yearTo: number,
) {
  const ref = await resolveCountry(ctx, country);
  const { records } = await fetchAllRows(ctx, {
    dataset: 'population',
    ...roleFilter(role, ref.iso3),
    yearFrom,
    yearTo,
  });
  return { ref, series: metricSeries(aggregateByYear(records), metric) };
}

export function registerAnalyticsTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'trend_analysis',
    {
      title: 'Trend analysis',
      description:
        'Analyse how a displacement metric evolved for a country: yearly series, year-over-year changes, linear trend (slope, R²), CAGR and statistically anomalous years. Default: refugees hosted, last 10 years.',
      inputSchema: {
        country: countryInput,
        metric: z
          .string()
          .optional()
          .describe('Metric: refugees, asylum_seekers, idps, stateless... (default refugees)'),
        role: CountryRoleSchema.optional(),
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        metric: z.string(),
        role: z.string(),
        series: z.array(YearValueSchema),
        year_over_year: z.array(
          z.object({
            year: z.number(),
            value: z.number(),
            change: z.number(),
            changePct: z.number().nullable(),
          }),
        ),
        trend: z.object({
          slope_per_year: z.number(),
          r2: z.number(),
          direction: z.enum(['increasing', 'decreasing', 'stable']),
          cagr_pct: z.number().nullable(),
        }),
        anomalies: z.array(z.object({ year: z.number(), change: z.number(), zScore: z.number() })),
        source: z.string(),
      },
    },
    async ({ country, metric, role, year_from, year_to }) => {
      const chosenMetric = metric ?? 'refugees';
      const chosenRole = role ?? 'asylum';
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'population');
      const { ref, series } = await countrySeries(
        ctx,
        country,
        chosenRole,
        chosenMetric,
        yearFrom,
        yearTo,
      );

      if (series.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No ${chosenMetric} data for ${ref.name} (${chosenRole} side) in ${yearFrom}–${yearTo}.`,
            },
          ],
          isError: true,
        };
      }

      const regression = linearRegression(series);
      const changes = yearOverYear(series);
      const anomalies = detectAnomalies(series);
      const growth = cagr(series);
      const direction =
        Math.abs(regression.slope) < Math.max(1, (series.at(-1)?.value ?? 0) * 0.005)
          ? ('stable' as const)
          : regression.slope > 0
            ? ('increasing' as const)
            : ('decreasing' as const);

      const table = markdownTable(
        ['Year', chosenMetric, 'Δ vs prev', 'Δ %'],
        series.map((p) => {
          const change = changes.find((c) => c.year === p.year);
          return [
            String(p.year),
            p.value,
            change?.change ?? null,
            change?.changePct !== null && change?.changePct !== undefined
              ? `${change.changePct.toFixed(1)}%`
              : '—',
          ];
        }),
      );

      const anomalyText =
        anomalies.length > 0
          ? anomalies
              .map(
                (a) =>
                  `${a.year} (${a.change > 0 ? '+' : ''}${formatNumber(a.change)}, z=${a.zScore.toFixed(1)})`,
              )
              .join(', ')
          : 'none detected';

      return {
        content: [
          {
            type: 'text',
            text: [
              `Trend — **${chosenMetric}**, ${ref.name} (${chosenRole} side), ${yearFrom}–${yearTo}`,
              '',
              table,
              '',
              `**Direction:** ${direction} (${formatNumber(Math.round(regression.slope))}/year, R²=${regression.r2.toFixed(2)})`,
              `**CAGR:** ${growth !== null ? `${growth.toFixed(1)}%` : 'n/a'}`,
              `**Anomalous years:** ${anomalyText}`,
              '',
              `_Source: ${citation}_`,
            ].join('\n'),
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          metric: chosenMetric,
          role: chosenRole,
          series,
          year_over_year: changes.map(({ year, value, change, changePct }) => ({
            year,
            value,
            change,
            changePct,
          })),
          trend: {
            slope_per_year: Math.round(regression.slope * 100) / 100,
            r2: Math.round(regression.r2 * 1000) / 1000,
            direction,
            cagr_pct: growth !== null ? Math.round(growth * 10) / 10 : null,
          },
          anomalies: anomalies.map((a) => ({
            year: a.year,
            change: a.change,
            zScore: Math.round(a.zScore * 100) / 100,
          })),
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'forecast',
    {
      title: 'Forecast (naive)',
      description:
        'Naive linear projection of a displacement metric 1–5 years ahead, based on the last 10 years. This is a statistical extrapolation, NOT a UNHCR planning figure — always present it with that caveat.',
      inputSchema: {
        country: countryInput,
        metric: z.string().optional().describe('Metric to project (default refugees)'),
        role: CountryRoleSchema.optional(),
        years_ahead: z.number().int().min(1).max(5).optional().describe('Horizon (default 3)'),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        metric: z.string(),
        historical: z.array(YearValueSchema),
        projected: z.array(YearValueSchema),
        method: z.string(),
        caveat: z.string(),
      },
    },
    async ({ country, metric, role, years_ahead }) => {
      const chosenMetric = metric ?? 'refugees';
      const horizon = years_ahead ?? 3;
      const yearTo = currentYear();
      const { ref, series } = await countrySeries(
        ctx,
        country,
        role ?? 'asylum',
        chosenMetric,
        yearTo - 9,
        yearTo,
      );

      if (series.length < 3) {
        return {
          content: [
            {
              type: 'text',
              text: `Not enough history to project ${chosenMetric} for ${ref.name} (need ≥3 data points, found ${series.length}).`,
            },
          ],
          isError: true,
        };
      }

      const projected = forecastLinear(series, horizon);
      const caveat =
        'Naive linear extrapolation of historical UNHCR data. Displacement is driven by events a straight line cannot anticipate; treat as an order-of-magnitude indication only.';

      const table = markdownTable(
        ['Year', chosenMetric, 'Type'],
        [
          ...series.map((p) => [String(p.year), p.value, 'observed'] as const),
          ...projected.map((p) => [String(p.year), p.value, 'projected'] as const),
        ],
      );

      return {
        content: [
          {
            type: 'text',
            text: `Projection — **${chosenMetric}**, ${ref.name}\n\n${table}\n\n⚠️ ${caveat}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          metric: chosenMetric,
          historical: series,
          projected,
          method: 'ordinary least squares over the last 10 observed years',
          caveat,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'top_host_countries',
    {
      title: 'Top host / origin countries',
      description:
        'Rank countries by a displacement metric for a year. by="asylum" (default) ranks host countries; by="origin" ranks countries people fled from. Set normalize_by="population" to rank per 1,000 residents (or "gdp" per US$1bn) — the ranking that shows Lebanon and Chad ahead of large economies.',
      inputSchema: {
        year: z
          .number()
          .int()
          .min(1951)
          .optional()
          .describe('Year to rank (default: latest available)'),
        metric: z.string().optional().describe('Metric to rank by (default refugees)'),
        by: CountryRoleSchema.optional().describe('Rank hosts ("asylum") or origins ("origin")'),
        normalize_by: NormalizeBySchema.optional(),
        limit: z.number().int().min(1).max(50).optional().describe('How many rows (default 10)'),
      },
      outputSchema: {
        year: z.number(),
        metric: z.string(),
        by: z.string(),
        normalize_by: z.string(),
        unit: z.string(),
        ranking: z.array(
          z.object({
            rank: z.number(),
            country: z.string(),
            country_code: z.string(),
            value: z.number(),
            raw_value: z.number().optional(),
            denominator_year: z.number().optional(),
          }),
        ),
        source: z.string(),
      },
    },
    async ({ year, metric, by, normalize_by, limit }) => {
      const chosenMetric = metric ?? 'refugees';
      const chosenBy = by ?? 'asylum';
      const normalizeBy = normalize_by ?? 'none';
      const topN = limit ?? 10;
      const { source, citation } = await datasetProvenance(ctx, 'population');

      // Resolve "latest available" by probing the last three years globally.
      let rankYear = year;
      if (rankYear === undefined) {
        const to = currentYear();
        const { records } = await fetchAllRows(ctx, {
          dataset: 'population',
          yearFrom: to - 2,
          yearTo: to,
        });
        rankYear = records.reduce((max, r) => Math.max(max, r.year), 0);
        if (rankYear === 0) {
          return {
            content: [{ type: 'text', text: 'Could not determine the latest data year.' }],
            isError: true,
          };
        }
      }

      const { records } = await fetchAllRows(ctx, {
        dataset: 'population',
        groupBy: chosenBy,
        yearFrom: rankYear,
        yearTo: rankYear,
      });

      const rawValues = records
        .map((r) => ({
          country: r.country,
          country_code: r.country_code,
          value: r.metrics[chosenMetric] ?? 0,
        }))
        .filter((r) => r.value > 0 && r.country_code !== '');

      let unit = 'people';
      let denominatorNote = '';
      interface RankEntry {
        country: string;
        country_code: string;
        value: number;
        raw_value?: number;
        denominator_year?: number;
      }
      let entries: RankEntry[] = rawValues;

      if (normalizeBy !== 'none') {
        const denominators = await fetchDenominators(ctx, normalizeBy, {
          yearFrom: rankYear,
          yearTo: rankYear,
        });
        const normalized: RankEntry[] = [];
        let skipped = 0;
        for (const entry of rawValues) {
          const result = normalizeValue(denominators, entry.country_code, rankYear, entry.value);
          if (result === null) {
            skipped += 1;
            continue;
          }
          normalized.push({
            country: entry.country,
            country_code: entry.country_code,
            value: Number(result.value.toFixed(3)),
            raw_value: entry.value,
            denominator_year: result.denominator_year,
          });
        }
        entries = normalized;
        unit = denominators.unit;
        denominatorNote =
          `\n\n_Ranked ${unit} — ${denominators.kind} denominators from ${denominators.citation}. ` +
          `Denominator years shown per row when they trail ${rankYear}._` +
          (skipped > 0
            ? `\n\n_${skipped} countries had no denominator data and were omitted._`
            : '');
      }

      const ranking = entries
        .sort((a, b) => b.value - a.value)
        .slice(0, topN)
        .map((r, i) => ({ rank: i + 1, ...r }));

      const normalizedColumns =
        normalizeBy !== 'none'
          ? {
              headers: ['#', 'Country', `${chosenMetric} ${unit}`, chosenMetric, 'Denom. year'],
              rows: ranking.map((r) => [
                r.rank,
                r.country,
                r.value,
                r.raw_value ?? null,
                r.denominator_year ?? null,
              ]),
            }
          : {
              headers: ['#', 'Country', chosenMetric],
              rows: ranking.map((r) => [r.rank, r.country, r.value]),
            };
      const table = markdownTable(normalizedColumns.headers, normalizedColumns.rows);

      return {
        content: [
          {
            type: 'text',
            text: `Top ${ranking.length} ${chosenBy === 'asylum' ? 'host' : 'origin'} countries by **${chosenMetric}**${normalizeBy !== 'none' ? ` (${unit})` : ''}, ${rankYear}\n\n${table}${denominatorNote}\n\n_Source: ${citation}_`,
          },
        ],
        structuredContent: {
          year: rankYear,
          metric: chosenMetric,
          by: chosenBy,
          normalize_by: normalizeBy,
          unit,
          ranking,
          source,
        },
      };
    },
  );
}
