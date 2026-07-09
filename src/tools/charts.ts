import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { CountryRoleSchema, countryInput, yearFromInput, yearToInput } from '../schemas/common.js';
import { toChartJs } from '../viz/chartjs.js';
import { toGeoJson } from '../viz/geojson.js';
import { toMermaid } from '../viz/mermaid.js';
import type { ChartSpecInput, Series } from '../viz/series.js';
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
import { NormalizeBySchema, fetchDenominators, normalizeValue } from './denominators.js';

export function registerChartTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'generate_chart',
    {
      title: 'Generate chart',
      description:
        'Render a displacement metric for one or more countries as a chart specification. Formats: "chartjs" (Chart.js v4 config JSON), "vega-lite" (v5 spec), "mermaid" (xychart block), "svg" (standalone image markup). Set normalize_by to plot per 1,000 residents or per US$1bn GDP.',
      inputSchema: {
        countries: z.array(countryInput).min(1).max(5).describe('Countries to plot'),
        metric: z.string().optional().describe('Metric to plot (default refugees)'),
        role: CountryRoleSchema.optional(),
        normalize_by: NormalizeBySchema.optional(),
        format: z.enum(['chartjs', 'vega-lite', 'mermaid', 'svg']).describe('Output format'),
        kind: z.enum(['line', 'bar']).optional().describe('Chart type (default line)'),
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        format: z.string(),
        title: z.string(),
        unit: z.string(),
        /** The spec: an object for chartjs/vega-lite, a string for mermaid/svg. */
        spec: z.union([z.record(z.unknown()), z.string()]),
      },
    },
    async ({ countries, metric, role, normalize_by, format, kind, year_from, year_to }) => {
      const chosenMetric = metric ?? 'refugees';
      const chosenRole = role ?? 'asylum';
      const normalizeBy = normalize_by ?? 'none';
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
      const { source } = await datasetProvenance(ctx, 'population');

      const resolved = await Promise.all(
        countries.map(async (country) => {
          const ref = await resolveCountry(ctx, country);
          const { records } = await fetchAllRows(ctx, {
            dataset: 'population',
            ...roleFilter(chosenRole, ref.iso3),
            yearFrom,
            yearTo,
          });
          return { ref, points: metricSeries(aggregateByYear(records), chosenMetric) };
        }),
      );

      let unit = 'people';
      let series: Series[];
      if (normalizeBy !== 'none') {
        const denominators = await fetchDenominators(
          ctx,
          normalizeBy,
          { yearFrom, yearTo },
          resolved.map((r) => r.ref.iso3),
        );
        unit = denominators.unit;
        series = resolved.map(({ ref, points }) => ({
          label: ref.name,
          points: points.flatMap((p) => {
            const normalized = normalizeValue(denominators, ref.iso3, p.year, p.value);
            return normalized === null
              ? []
              : [{ x: p.year, y: Number(normalized.value.toFixed(3)) }];
          }),
        }));
      } else {
        series = resolved.map(({ ref, points }) => ({
          label: ref.name,
          points: points.map((p) => ({ x: p.year, y: p.value })),
        }));
      }

      if (series.every((s) => s.points.length === 0)) {
        return {
          content: [
            {
              type: 'text',
              text: `No ${chosenMetric} data found for those countries in ${yearFrom}–${yearTo}.`,
            },
          ],
          isError: true,
        };
      }

      const metricLabel = normalizeBy !== 'none' ? `${chosenMetric} ${unit}` : chosenMetric;
      const title = `${metricLabel} (${chosenRole} side), ${yearFrom}–${yearTo} — ${source.toUpperCase()}`;
      const input: ChartSpecInput = {
        title,
        kind: kind ?? 'line',
        xLabel: 'Year',
        yLabel: metricLabel,
        series,
      };

      let spec: Record<string, unknown> | string;
      let text: string;
      switch (format) {
        case 'chartjs':
          spec = toChartJs(input);
          text = `Chart.js v4 config for "${title}":\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
          break;
        case 'vega-lite':
          spec = toVegaLite(input);
          text = `Vega-Lite v5 spec for "${title}":\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
          break;
        case 'mermaid':
          spec = toMermaid(input);
          text = spec;
          break;
        case 'svg':
          spec = toSvg(input);
          text = `SVG chart for "${title}":\n\n\`\`\`svg\n${spec}\n\`\`\``;
          break;
      }

      return {
        content: [{ type: 'text', text }],
        structuredContent: { format, title, unit, spec },
      };
    },
  );

  defineTool(
    server,
    ctx,
    'generate_map',
    {
      title: 'Generate map (GeoJSON)',
      description:
        'GeoJSON FeatureCollection of country centroid points sized by a displacement metric — drop it into any GeoJSON viewer (geojson.io, Leaflet, Kepler). by="asylum" maps host countries, by="origin" maps origins.',
      inputSchema: {
        year: z.number().int().min(1951).optional().describe('Year (default: latest)'),
        metric: z.string().optional().describe('Metric for point properties (default refugees)'),
        by: CountryRoleSchema.optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Top-N countries (default 25)'),
      },
      outputSchema: {
        year: z.number(),
        metric: z.string(),
        feature_count: z.number(),
        skipped_countries: z.array(z.string()),
        geojson: z.record(z.unknown()),
      },
    },
    async ({ year, metric, by, limit }) => {
      const chosenMetric = metric ?? 'refugees';
      const chosenBy = by ?? 'asylum';

      let mapYear = year;
      if (mapYear === undefined) {
        const to = currentYear();
        const { records } = await fetchAllRows(ctx, {
          dataset: 'population',
          yearFrom: to - 2,
          yearTo: to,
        });
        mapYear = records.reduce((max, r) => Math.max(max, r.year), 0);
      }

      const { records } = await fetchAllRows(ctx, {
        dataset: 'population',
        groupBy: chosenBy,
        yearFrom: mapYear,
        yearTo: mapYear,
      });

      const top = records
        .filter((r) => (r.metrics[chosenMetric] ?? 0) > 0 && r.country_code !== '')
        .sort((a, b) => (b.metrics[chosenMetric] ?? 0) - (a.metrics[chosenMetric] ?? 0))
        .slice(0, limit ?? 25);

      const { featureCollection, skipped } = toGeoJson(top);
      const featureCount = (featureCollection['features'] as unknown[]).length;

      return {
        content: [
          {
            type: 'text',
            text: `GeoJSON map — top ${top.length} ${chosenBy === 'asylum' ? 'host' : 'origin'} countries by ${chosenMetric}, ${mapYear} (${featureCount} features${skipped.length > 0 ? `; no centroid for: ${skipped.join(', ')}` : ''})\n\n\`\`\`json\n${JSON.stringify(featureCollection)}\n\`\`\``,
          },
        ],
        structuredContent: {
          year: mapYear,
          metric: chosenMetric,
          feature_count: featureCount,
          skipped_countries: skipped,
          geojson: featureCollection,
        },
      };
    },
  );
}
