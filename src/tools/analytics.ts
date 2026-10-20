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
import type { Translator } from '../i18n/index.js';
import {
  cagr,
  detectAnomalies,
  detectChangepoints,
  forecastLinearIntervals,
  linearRegression,
  yearOverYear,
} from '../shared/stats.js';
import type { ChangepointResult } from '../shared/stats.js';
import { toChartJs } from '../viz/chartjs.js';
import type { ChartSpecInput } from '../viz/series.js';
import { toSvg } from '../viz/svg.js';
import { toVegaLite } from '../viz/vega.js';
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

const ChangepointSchema = z.object({
  year: z.number(),
  level_shift: z.number(),
  slope_before: z.number(),
  slope_after: z.number(),
});

/** Structured (English, rounded) changepoints for outputSchema payloads. */
function changepointPayload(result: ChangepointResult) {
  return result.changepoints.map((c) => ({
    year: c.year,
    level_shift: Math.round(c.levelShift),
    slope_before: Math.round(c.slopeBefore),
    slope_after: Math.round(c.slopeAfter),
  }));
}

/** "2023 (jump +599,037 vs prior trend; slope +31,370 → +661,907/year)" list. */
export function changepointText(result: ChangepointResult, tr: Translator): string {
  if (result.changepoints.length === 0) return tr.m.trend.noChangepoints;
  return result.changepoints
    .map((c) =>
      tr.m.trend.changepoint(
        tr.year(c.year),
        tr.signed(Math.round(c.levelShift)),
        tr.signed(Math.round(c.slopeBefore)),
        tr.signed(Math.round(c.slopeAfter)),
      ),
    )
    .join(tr.m.meta.listSeparator);
}

export function registerAnalyticsTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'trend_analysis',
    {
      title: 'Trend analysis',
      description:
        'Analyse how a displacement metric evolved for a country: yearly series, year-over-year changes, linear trend (slope, R²), CAGR, statistically anomalous years (z-scores of yearly changes) and changepoints (structural breaks in level/slope, exact penalised segmentation). Default: refugees hosted, last 10 years — widen year_from for better changepoint power.',
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
        changepoints: z.array(ChangepointSchema),
        segments: z.array(
          z.object({ from: z.number(), to: z.number(), slope_per_year: z.number() }),
        ),
        source: z.string(),
      },
    },
    async ({ country, metric, role, year_from, year_to }, _extra, tr) => {
      const chosenMetric = metric ?? 'refugees';
      const chosenRole = role ?? 'asylum';
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'population');
      const metricLabel = tr.metric(chosenMetric);
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
              text: tr.m.trend.noData(
                metricLabel,
                tr.country(ref.iso3, ref.name),
                tr.side(chosenRole),
                tr.range(yearFrom, yearTo),
              ),
            },
          ],
          isError: true,
        };
      }

      const regression = linearRegression(series);
      const changes = yearOverYear(series);
      const anomalies = detectAnomalies(series);
      const breaks = detectChangepoints(series);
      const growth = cagr(series);
      const direction =
        Math.abs(regression.slope) < Math.max(1, (series.at(-1)?.value ?? 0) * 0.005)
          ? ('stable' as const)
          : regression.slope > 0
            ? ('increasing' as const)
            : ('decreasing' as const);

      const table = tr.table(
        [tr.m.common.year, metricLabel, tr.m.trend.deltaPrev, tr.m.trend.deltaPct],
        series.map((p) => {
          const change = changes.find((c) => c.year === p.year);
          return [
            tr.year(p.year),
            p.value,
            change ? tr.signed(change.change) : null,
            change?.changePct !== null && change?.changePct !== undefined
              ? tr.pct(change.changePct)
              : '—',
          ];
        }),
      );

      const anomalyText =
        anomalies.length > 0
          ? anomalies
              .map((a) =>
                tr.m.trend.anomaly(tr.year(a.year), tr.signed(a.change), tr.fixed(a.zScore, 1)),
              )
              .join(tr.m.meta.listSeparator)
          : tr.m.trend.noneDetected;

      return {
        content: [
          {
            type: 'text',
            text: [
              tr.m.trend.heading(
                metricLabel,
                tr.country(ref.iso3, ref.name),
                tr.side(chosenRole),
                tr.range(yearFrom, yearTo),
              ),
              '',
              table,
              '',
              tr.m.trend.directionLine(
                tr.m.trend.direction[direction],
                tr.num(Math.round(regression.slope)),
                tr.fixed(regression.r2, 2),
              ),
              tr.m.trend.cagrLine(growth !== null ? tr.pct(growth) : tr.m.common.na),
              tr.m.trend.anomaliesLine(anomalyText),
              tr.m.trend.changepointsLine(changepointText(breaks, tr)),
              '',
              tr.m.trend.changepointMethod,
              '',
              tr.sourceLine(citation, source),
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
          changepoints: changepointPayload(breaks),
          segments: breaks.segments.map((s) => ({
            from: s.from,
            to: s.to,
            slope_per_year: Math.round(s.slope * 100) / 100,
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
      title: 'Forecast (naive, with prediction intervals)',
      description:
        'Naive linear projection of a displacement metric 1–5 years ahead, based on the last 10 years, with 80% and 95% OLS prediction intervals. Structural breaks in the history are detected and reported; since_break=true fits only the data after the latest break. Optional chart (svg / chartjs / vega-lite) with the interval band. This is a statistical extrapolation, NOT a UNHCR planning figure — always present it with that caveat.',
      inputSchema: {
        country: countryInput,
        metric: z.string().optional().describe('Metric to project (default refugees)'),
        role: CountryRoleSchema.optional(),
        years_ahead: z.number().int().min(1).max(5).optional().describe('Horizon (default 3)'),
        since_break: z
          .boolean()
          .optional()
          .describe(
            'Fit only the years since the latest detected structural break (needs ≥3 years after it). Default false.',
          ),
        chart: z
          .enum(['svg', 'chartjs', 'vega-lite'])
          .optional()
          .describe('Also return a chart of observed + projected values with the interval band'),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        metric: z.string(),
        historical: z.array(YearValueSchema),
        projected: z.array(
          z.object({
            year: z.number(),
            value: z.number(),
            lower_80: z.number(),
            upper_80: z.number(),
            lower_95: z.number(),
            upper_95: z.number(),
          }),
        ),
        fit_from: z.number(),
        fit_to: z.number(),
        changepoints: z.array(ChangepointSchema),
        method: z.string(),
        intervals: z.string(),
        caveat: z.string(),
        chart: z
          .object({ format: z.string(), spec: z.union([z.record(z.unknown()), z.string()]) })
          .optional(),
      },
    },
    async ({ country, metric, role, years_ahead, since_break, chart }, _extra, tr) => {
      const chosenMetric = metric ?? 'refugees';
      const metricLabel = tr.metric(chosenMetric);
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
      const name = tr.country(ref.iso3, ref.name);

      if (series.length < 3) {
        return {
          content: [
            {
              type: 'text',
              text: tr.m.forecast.notEnough(metricLabel, name, tr.num(series.length)),
            },
          ],
          isError: true,
        };
      }

      const breaks = detectChangepoints(series);
      const lastBreak = breaks.changepoints.at(-1);
      const sinceBreak = lastBreak ? series.filter((p) => p.year >= lastBreak.year) : [];
      const useBreak = since_break === true && lastBreak !== undefined && sinceBreak.length >= 3;
      const fitSeries = useBreak ? sinceBreak : series;
      const fitFrom = fitSeries[0]!.year;
      const fitTo = fitSeries.at(-1)!.year;
      const projected = forecastLinearIntervals(fitSeries, horizon);
      const caveat = tr.m.forecast.caveat;

      const table = tr.table(
        [tr.m.common.year, metricLabel, tr.m.forecast.type, ...tr.m.forecast.intervalHeaders],
        [
          ...series.map(
            (p) =>
              [tr.year(p.year), p.value, tr.m.forecast.observed, null, null, null, null] as const,
          ),
          ...projected.map(
            (p) =>
              [
                tr.year(p.year),
                p.value,
                tr.m.forecast.projected,
                p.lower80,
                p.upper80,
                p.lower95,
                p.upper95,
              ] as const,
          ),
        ],
      );

      const notes = [tr.m.forecast.fitWindow(tr.range(fitFrom, fitTo))];
      if (lastBreak) {
        notes.push(
          useBreak
            ? tr.m.forecast.breakSince(tr.year(lastBreak.year))
            : tr.m.forecast.breakAcross(tr.year(lastBreak.year)),
        );
      }
      notes.push(tr.m.forecast.intervalNote);

      let chartPayload: { format: string; spec: Record<string, unknown> | string } | undefined;
      let chartText = '';
      if (chart) {
        const { source } = await datasetProvenance(ctx, 'population');
        const last = series.at(-1)!;
        const anchor = { x: last.year, low: last.value, high: last.value };
        const input: ChartSpecInput = {
          title: tr.m.forecast.chartTitle(metricLabel, name, source.toUpperCase()),
          kind: 'line',
          xLabel: tr.m.common.year,
          yLabel: metricLabel,
          series: [
            {
              label: tr.m.forecast.observedSeries(name),
              points: series.map((p) => ({ x: p.year, y: p.value })),
            },
            {
              label: tr.m.forecast.projectedSeries(name),
              dashed: true,
              points: [
                { x: last.year, y: last.value },
                ...projected.map((p) => ({ x: p.year, y: p.value })),
              ],
            },
          ],
          bands: [
            {
              label: tr.m.forecast.band(tr.pct(95, 0)),
              points: [
                anchor,
                ...projected.map((p) => ({ x: p.year, low: p.lower95, high: p.upper95 })),
              ],
            },
            {
              label: tr.m.forecast.band(tr.pct(80, 0)),
              points: [
                anchor,
                ...projected.map((p) => ({ x: p.year, low: p.lower80, high: p.upper80 })),
              ],
            },
          ],
          markers: breaks.changepoints.map((c) => ({
            x: c.year,
            label: tr.m.charts.breakMarker(tr.year(c.year)),
          })),
          ...tr.chartOptions(),
        };
        const spec =
          chart === 'svg'
            ? toSvg(input)
            : chart === 'chartjs'
              ? toChartJs(input)
              : toVegaLite(input);
        chartPayload = { format: chart, spec };
        chartText =
          typeof spec === 'string'
            ? `\n\n${tr.m.charts.svgIntro(input.title)}\n\n\`\`\`svg\n${spec}\n\`\`\``
            : `\n\n${chart === 'chartjs' ? tr.m.charts.chartjsIntro(input.title) : tr.m.charts.vegaIntro(input.title)}\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
      }

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.forecast.heading(metricLabel, name)}\n\n${table}\n\n${notes.join('\n')}\n\n⚠️ ${caveat}${chartText}`,
          },
        ],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          metric: chosenMetric,
          historical: series,
          projected: projected.map((p) => ({
            year: p.year,
            value: p.value,
            lower_80: p.lower80,
            upper_80: p.upper80,
            lower_95: p.lower95,
            upper_95: p.upper95,
          })),
          fit_from: fitFrom,
          fit_to: fitTo,
          changepoints: changepointPayload(breaks),
          method: useBreak
            ? `ordinary least squares on ${fitFrom}–${fitTo} (since the latest structural break)`
            : 'ordinary least squares over the last 10 observed years',
          intervals:
            'OLS prediction intervals, Student-t with n-2 degrees of freedom (80% and 95%); lower bounds floored at 0',
          caveat,
          ...(chartPayload ? { chart: chartPayload } : {}),
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
    async ({ year, metric, by, normalize_by, limit }, _extra, tr) => {
      const chosenMetric = metric ?? 'refugees';
      const metricLabel = tr.metric(chosenMetric);
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
            content: [{ type: 'text', text: tr.m.ranking.noLatestYear }],
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
      let unitLabel = tr.unit('people');
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
        unitLabel = tr.unit(normalizeBy);
        denominatorNote =
          tr.m.denominators.rankedNote(
            unitLabel,
            tr.m.denominators.kind[denominators.kind],
            denominators.citation,
            tr.year(rankYear),
          ) + (skipped > 0 ? tr.m.denominators.skippedNote(tr.num(skipped)) : '');
      }

      const ranking = entries
        .sort((a, b) => b.value - a.value)
        .slice(0, topN)
        .map((r, i) => ({ rank: i + 1, ...r }));

      const normalizedColumns =
        normalizeBy !== 'none'
          ? {
              headers: [
                '#',
                tr.m.common.country,
                `${metricLabel} ${unitLabel}`,
                metricLabel,
                tr.m.ranking.denomYear,
              ],
              rows: ranking.map((r) => [
                r.rank,
                tr.country(r.country_code, r.country),
                r.value,
                r.raw_value ?? null,
                r.denominator_year !== undefined ? tr.year(r.denominator_year) : null,
              ]),
            }
          : {
              headers: ['#', tr.m.common.country, metricLabel],
              rows: ranking.map((r) => [r.rank, tr.country(r.country_code, r.country), r.value]),
            };
      const table = tr.table(normalizedColumns.headers, normalizedColumns.rows);

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.ranking.heading(tr.num(ranking.length), chosenBy, metricLabel, normalizeBy !== 'none' ? unitLabel : undefined, tr.year(rankYear))}\n\n${table}${denominatorNote}\n\n${tr.sourceLine(citation, source)}`,
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
