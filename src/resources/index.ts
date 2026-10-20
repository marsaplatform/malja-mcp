import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../context.js';
import { toChartJs } from '../viz/chartjs.js';
import { buildCountryReport } from '../tools/reports.js';
import { fetchSolutions } from '../tools/solutions.js';
import {
  aggregateByYear,
  currentYear,
  datasetProvenance,
  fetchAllRows,
  latestAggregates,
  metricSeries,
  resolveCountry,
  translatorFor,
} from '../tools/common.js';

/**
 * MCP resources: addressable, read-only views over the same normalized data
 * the tools serve.
 *
 *   metadata://providers      — provider + dataset catalogue
 *   metadata://countries      — all known countries with ISO codes
 *   metadata://datasets       — dataset descriptors across providers
 *   dataset://{id}            — one dataset descriptor
 *   country://{code}          — latest humanitarian snapshot for a country
 *   report://{code}           — full markdown situation report
 *   chart://{code}            — Chart.js config of the country's refugee trend
 *   solutions://{code}        — 10-year durable-solution flows (returns, resettlement…)
 */
export function registerResources(server: McpServer, ctx: AppContext): void {
  server.registerResource(
    'providers-metadata',
    'metadata://providers',
    {
      title: 'Connected providers',
      description: 'All enabled data providers with their datasets, attribution and terms',
      mimeType: 'application/json',
    },
    async (uri) => {
      const providers = await Promise.all(ctx.registry.all().map((p) => p.metadata()));
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(providers, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'countries-metadata',
    'metadata://countries',
    {
      title: 'Country reference',
      description: 'All countries known to the primary provider, with ISO codes and regions',
      mimeType: 'application/json',
    },
    async (uri) => {
      const provider = ctx.registry.primary();
      const countries = provider.countries ? await provider.countries() : [];
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(countries, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'datasets-metadata',
    'metadata://datasets',
    {
      title: 'Dataset catalogue',
      description: 'Every dataset served by any enabled provider, with metrics and citations',
      mimeType: 'application/json',
    },
    async (uri) => {
      const providers = await Promise.all(ctx.registry.all().map((p) => p.metadata()));
      const datasets = providers.flatMap((p) => p.datasets.map((d) => ({ ...d, provider: p.id })));
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(datasets, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'dataset',
    new ResourceTemplate('dataset://{id}', {
      list: async () => {
        const providers = await Promise.all(ctx.registry.all().map((p) => p.metadata()));
        return {
          resources: providers.flatMap((p) =>
            p.datasets.map((d) => ({
              uri: `dataset://${d.id}`,
              name: d.title,
              description: d.description,
              mimeType: 'application/json',
            })),
          ),
        };
      },
    }),
    {
      title: 'Dataset descriptor',
      description: 'Metadata for one dataset: metrics, coverage, citation',
      mimeType: 'application/json',
    },
    async (uri, { id }) => {
      const providers = await Promise.all(ctx.registry.all().map((p) => p.metadata()));
      const dataset = providers
        .flatMap((p) => p.datasets.map((d) => ({ ...d, provider: p.id })))
        .find((d) => d.id === String(id));
      if (!dataset) {
        throw new Error(
          `Unknown dataset "${String(id)}" — read metadata://datasets for the catalogue`,
        );
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dataset, null, 2) },
        ],
      };
    },
  );

  const completeCountryCode = async (value: string): Promise<string[]> => {
    const matches = await ctx.registry.primary().search({ query: value, limit: 20 });
    return matches.map((m) => m.iso3);
  };

  server.registerResource(
    'country',
    new ResourceTemplate('country://{code}', {
      list: undefined,
      complete: { code: completeCountryCode },
    }),
    {
      title: 'Country snapshot',
      description:
        'Latest humanitarian snapshot for a country by ISO3 code or name, e.g. country://EGY or country://egypt',
      mimeType: 'application/json',
    },
    async (uri, { code }) => {
      const ref = await resolveCountry(ctx, String(code));
      const [hosted, abroad, provenance] = await Promise.all([
        latestAggregates(ctx, 'population', { asylum_iso3: ref.iso3 }),
        latestAggregates(ctx, 'population', { origin_iso3: ref.iso3 }),
        datasetProvenance(ctx, 'population'),
      ]);
      const snapshot = {
        country: ref.name,
        country_code: ref.iso3,
        region: ref.region,
        year: hosted?.year ?? abroad?.year,
        hosted: hosted?.metrics ?? {},
        displaced_abroad: abroad?.metrics ?? {},
        source: provenance.source,
      };
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(snapshot, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'report',
    new ResourceTemplate('report://{code}', {
      list: undefined,
      complete: { code: completeCountryCode },
    }),
    {
      title: 'Country situation report',
      description: 'Full markdown humanitarian report for a country, e.g. report://SDN',
      mimeType: 'text/markdown',
    },
    async (uri, { code }) => {
      const ref = await resolveCountry(ctx, String(code));
      const yearTo = currentYear();
      const markdown = await buildCountryReport(ctx, ref, yearTo - 9, yearTo);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: markdown }] };
    },
  );

  server.registerResource(
    'chart',
    new ResourceTemplate('chart://{code}', {
      list: undefined,
      complete: { code: completeCountryCode },
    }),
    {
      title: 'Refugee trend chart',
      description: 'Chart.js config of the 10-year refugee trend for a country, e.g. chart://UGA',
      mimeType: 'application/json',
    },
    async (uri, { code }) => {
      const ref = await resolveCountry(ctx, String(code));
      const yearTo = currentYear();
      const [{ records }, provenance] = await Promise.all([
        fetchAllRows(ctx, {
          dataset: 'population',
          asylum_iso3: ref.iso3,
          yearFrom: yearTo - 9,
          yearTo,
        }),
        datasetProvenance(ctx, 'population'),
      ]);
      const points = metricSeries(aggregateByYear(records), 'refugees');
      // Resources take no arguments: they follow the server default (MALJA_LOCALE).
      const tr = translatorFor(ctx, undefined);
      const name = tr.country(ref.iso3, ref.name);
      const config = toChartJs({
        title: `${tr.m.charts.refugeesHostedIn(name)} — ${provenance.source.toUpperCase()}`,
        kind: 'line',
        xLabel: tr.m.common.year,
        yLabel: tr.m.common.refugees,
        series: [{ label: name, points: points.map((p) => ({ x: p.year, y: p.value })) }],
        ...tr.chartOptions(),
      });
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(config, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'solutions',
    new ResourceTemplate('solutions://{code}', {
      list: undefined,
      complete: { code: completeCountryCode },
    }),
    {
      title: 'Durable solutions',
      description:
        'Durable-solution FLOWS for people from a country over the last 10 years (refugee returns, resettlement, naturalisation, IDP returns), e.g. solutions://SYR',
      mimeType: 'application/json',
    },
    async (uri, { code }) => {
      const ref = await resolveCountry(ctx, String(code));
      const yearTo = currentYear();
      const summary = await fetchSolutions(ctx, ref, 'origin', { yearFrom: yearTo - 9, yearTo });
      const payload = {
        country: ref.name,
        country_code: ref.iso3,
        role: 'origin',
        measure: 'flow',
        year_from: summary.yearFrom,
        year_to: summary.yearTo,
        years: summary.years,
        period_totals: summary.periodTotals,
        period_total: summary.periodTotal,
        source: summary.source,
        citation: summary.citation,
      };
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) },
        ],
      };
    },
  );
}
