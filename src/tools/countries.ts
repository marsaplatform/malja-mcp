import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  CountryMatchSchema,
  CountryRoleSchema,
  YearValueSchema,
  countryInput,
  yearFromInput,
  yearToInput,
} from '../schemas/common.js';
import {
  aggregateByYear,
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  latestAggregates,
  metricSeries,
  resolveCountry,
  roleFilter,
} from './common.js';
import { NormalizeBySchema, fetchDenominators, normalizeValue } from './denominators.js';

export function registerCountryTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'search_country',
    {
      title: 'Search country',
      description:
        'Resolve a free-text country query ("egypt", "DRC", "syria") to canonical names and ISO3 codes. Use this first when unsure how a country is spelled in the data.',
      inputSchema: {
        query: z.string().min(1).describe('Country name fragment, ISO2/ISO3 code or alias'),
        limit: z.number().int().min(1).max(20).optional().describe('Max matches (default 5)'),
      },
      outputSchema: {
        matches: z.array(CountryMatchSchema),
      },
    },
    async ({ query, limit }, _extra, tr) => {
      const matches = await ctx.registry.primary().search({ query, limit: limit ?? 5 });
      const table = tr.table(
        [tr.m.common.country, 'ISO3', tr.m.common.region, tr.m.search.match],
        matches.map((m) => [
          tr.country(m.iso3, m.name),
          m.iso3,
          m.region ? tr.region(m.region) : '—',
          tr.fixed(m.score, 2),
        ]),
      );
      return {
        content: [{ type: 'text', text: table }],
        structuredContent: { matches },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'country_profile',
    {
      title: 'Country profile',
      description:
        'One-call humanitarian snapshot of a country: latest displaced population hosted (by category), population displaced FROM the country, and its top origin countries.',
      inputSchema: { country: countryInput },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        region: z.string().optional(),
        year: z.number().optional(),
        hosted: z
          .record(z.number())
          .describe('Latest people-of-concern figures hosted in the country'),
        displaced_abroad: z
          .record(z.number())
          .describe('Latest figures for people displaced FROM the country'),
        top_origins: z.array(
          z.object({ country: z.string(), country_code: z.string(), refugees: z.number() }),
        ),
        source: z.string(),
      },
    },
    async ({ country }, _extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const { source } = await datasetProvenance(ctx, 'population');
      const name = tr.country(ref.iso3, ref.name);

      const [hosted, fromCountry] = await Promise.all([
        latestAggregates(ctx, 'population', { asylum_iso3: ref.iso3 }),
        latestAggregates(ctx, 'population', { origin_iso3: ref.iso3 }),
      ]);

      const year = hosted?.year ?? fromCountry?.year;
      let topOrigins: { country: string; country_code: string; refugees: number }[] = [];
      if (hosted) {
        const { records } = await fetchAllRows(ctx, {
          dataset: 'population',
          asylum_iso3: ref.iso3,
          groupBy: 'origin',
          yearFrom: hosted.year,
          yearTo: hosted.year,
        });
        topOrigins = records
          .filter((r) => r.origin && (r.metrics['refugees'] ?? 0) > 0)
          .sort((a, b) => (b.metrics['refugees'] ?? 0) - (a.metrics['refugees'] ?? 0))
          .slice(0, 5)
          .map((r) => ({
            country: r.origin ?? '',
            country_code: r.origin_code ?? '',
            refugees: r.metrics['refugees'] ?? 0,
          }));
      }

      const m = tr.m;
      const indicatorTable = (metrics: Record<string, number>): string =>
        tr.table(
          [m.common.indicator, m.common.people],
          Object.entries(metrics).map(([k, v]) => [tr.metric(k), v]),
        );
      const producer = tr.producer(source);
      const lines = [
        m.profile.title(name, year !== undefined ? tr.year(year) : undefined),
        '',
        m.profile.infoLine(tr.region(ref.region), ref.iso3, producer || source),
        '',
        m.profile.hosted,
        hosted ? indicatorTable(hosted.metrics) : m.common.noRecentData,
        '',
        m.profile.abroad,
        fromCountry ? indicatorTable(fromCountry.metrics) : m.common.noRecentData,
      ];
      if (topOrigins.length > 0) {
        lines.push(
          '',
          m.profile.topOrigins,
          tr.table(
            [m.common.origin, m.common.refugees],
            topOrigins.map((o) => [tr.country(o.country_code, o.country), o.refugees]),
          ),
        );
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          ...(ref.region ? { region: ref.region } : {}),
          ...(year !== undefined ? { year } : {}),
          hosted: hosted?.metrics ?? {},
          displaced_abroad: fromCountry?.metrics ?? {},
          top_origins: topOrigins,
          source,
        },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'compare_countries',
    {
      title: 'Compare countries',
      description:
        'Compare a displacement metric across 2–5 countries over a year range. Defaults to refugees hosted (role "asylum") over the last 10 years. Set normalize_by to compare per 1,000 residents or per US$1bn GDP instead of absolute numbers.',
      inputSchema: {
        countries: z.array(countryInput).min(2).max(5).describe('Two to five countries to compare'),
        metric: z
          .string()
          .optional()
          .describe('Metric to compare, e.g. refugees, asylum_seekers, idps (default: refugees)'),
        role: CountryRoleSchema.optional(),
        normalize_by: NormalizeBySchema.optional(),
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        metric: z.string(),
        role: z.string(),
        normalize_by: z.string(),
        unit: z.string(),
        series: z.array(
          z.object({
            country: z.string(),
            country_code: z.string(),
            points: z.array(YearValueSchema),
          }),
        ),
        denominator: z
          .object({ source: z.string(), citation: z.string(), metric: z.string() })
          .optional(),
        source: z.string(),
      },
    },
    async ({ countries, metric, role, normalize_by, year_from, year_to }, _extra, tr) => {
      const chosenMetric = metric ?? 'refugees';
      const chosenRole = role ?? 'asylum';
      const normalizeBy = normalize_by ?? 'none';
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source, citation } = await datasetProvenance(ctx, 'population');

      const refs = await Promise.all(countries.map((c) => resolveCountry(ctx, c)));
      let series = await Promise.all(
        refs.map(async (ref) => {
          const { records } = await fetchAllRows(ctx, {
            dataset: 'population',
            ...roleFilter(chosenRole, ref.iso3),
            yearFrom,
            yearTo,
          });
          return {
            country: ref.name,
            country_code: ref.iso3,
            points: metricSeries(aggregateByYear(records), chosenMetric),
          };
        }),
      );

      let unit = 'people';
      let unitLabel = tr.unit('people');
      let denominatorInfo: { source: string; citation: string; metric: string } | undefined;
      let denominatorNote = '';
      if (normalizeBy !== 'none') {
        const denominators = await fetchDenominators(
          ctx,
          normalizeBy,
          { yearFrom, yearTo },
          refs.map((r) => r.iso3),
        );
        series = series.map((s) => ({
          ...s,
          points: s.points.flatMap((p) => {
            const normalized = normalizeValue(denominators, s.country_code, p.year, p.value);
            return normalized === null
              ? []
              : [{ year: p.year, value: Number(normalized.value.toFixed(3)) }];
          }),
        }));
        unit = denominators.unit;
        unitLabel = tr.unit(normalizeBy);
        denominatorInfo = {
          source: denominators.source,
          citation: denominators.citation,
          metric: denominators.metric,
        };
        const missing = refs.filter((r) => !denominators.series.has(r.iso3)).map((r) => r.iso3);
        denominatorNote =
          tr.m.denominators.valuesNote(
            unitLabel,
            tr.m.denominators.kind[denominators.kind],
            denominators.citation,
          ) + (missing.length > 0 ? tr.m.denominators.missingNote(missing.join(', ')) : '');
      }

      const years = [...new Set(series.flatMap((s) => s.points.map((p) => p.year)))].sort();
      const table = tr.table(
        [tr.m.common.year, ...series.map((s) => tr.country(s.country_code, s.country))],
        years.map((year) => [
          tr.year(year),
          ...series.map((s) => s.points.find((p) => p.year === year)?.value ?? null),
        ]),
      );

      const latest = years.at(-1);
      const summary = latest
        ? series
            .map((s) => {
              const value = s.points.find((p) => p.year === latest)?.value;
              return `${tr.country(s.country_code, s.country)}: ${value !== undefined ? tr.num(value) : tr.m.common.na}`;
            })
            .join(tr.m.meta.dotSeparator)
        : tr.m.compare.noOverlap;

      return {
        content: [
          {
            type: 'text',
            text: `${tr.m.compare.heading(tr.metric(chosenMetric), normalizeBy !== 'none' ? unitLabel : undefined, tr.side(chosenRole), tr.range(yearFrom, yearTo))}\n\n${table}\n\n${tr.m.compare.latest(latest !== undefined ? tr.year(latest) : tr.m.common.na, summary)}${denominatorNote}\n\n${tr.sourceLine(citation, source)}`,
          },
        ],
        structuredContent: {
          metric: chosenMetric,
          role: chosenRole,
          normalize_by: normalizeBy,
          unit,
          series,
          ...(denominatorInfo ? { denominator: denominatorInfo } : {}),
          source,
        },
      };
    },
  );
}
