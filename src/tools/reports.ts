import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { CountryRef } from '../providers/types.js';
import { countryInput, yearFromInput, yearToInput } from '../schemas/common.js';
import { linearRegression, yearOverYear } from '../shared/stats.js';
import { toMermaid } from '../viz/mermaid.js';
import type { ChartSpecInput } from '../viz/series.js';
import { toSvg } from '../viz/svg.js';
import type { Translator } from '../i18n/index.js';
import {
  aggregateByYear,
  datasetProvenance,
  defaultYearRange,
  defineTool,
  fetchAllRows,
  latestAggregates,
  metricSeries,
  reportProgress,
  resolveCountry,
  translatorFor,
} from './common.js';

/**
 * Compose a full markdown country report from the population, asylum and
 * demographics datasets. Emits MCP progress notifications while it works.
 */
export async function buildCountryReport(
  ctx: AppContext,
  ref: CountryRef,
  yearFrom: number,
  yearTo: number,
  onProgress: (step: number, total: number, message: string) => Promise<void> = async () => {},
  tr: Translator = translatorFor(ctx, undefined),
  options: { chart?: 'mermaid' | 'svg' } = {},
): Promise<string> {
  const TOTAL_STEPS = 5;
  const m = tr.m;
  const name = tr.country(ref.iso3, ref.name);
  const { citation, source } = await datasetProvenance(ctx, 'population');
  const producer = tr.producer(source);
  const citationText = producer ? `${producer} — ${citation}` : citation;

  await onProgress(1, TOTAL_STEPS, m.report.progress.history);
  const { records: popRecords } = await fetchAllRows(ctx, {
    dataset: 'population',
    asylum_iso3: ref.iso3,
    yearFrom,
    yearTo,
  });
  const popAggregates = aggregateByYear(popRecords);
  const refugeeSeries = metricSeries(popAggregates, 'refugees');

  await onProgress(2, TOTAL_STEPS, m.report.progress.origins);
  const latest = popAggregates.at(-1);
  let topOriginsTable = m.common.noData;
  if (latest) {
    const { records } = await fetchAllRows(ctx, {
      dataset: 'population',
      asylum_iso3: ref.iso3,
      groupBy: 'origin',
      yearFrom: latest.year,
      yearTo: latest.year,
    });
    const top = records
      .filter((r) => r.origin && (r.metrics['refugees'] ?? 0) > 0)
      .sort((a, b) => (b.metrics['refugees'] ?? 0) - (a.metrics['refugees'] ?? 0))
      .slice(0, 8);
    if (top.length > 0) {
      topOriginsTable = tr.table(
        [m.common.origin, m.common.refugees],
        top.map((r) => [tr.country(r.origin_code, r.origin ?? ''), r.metrics['refugees'] ?? 0]),
      );
    }
  }

  await onProgress(3, TOTAL_STEPS, m.report.progress.asylum);
  const { records: decisionRecords } = await fetchAllRows(ctx, {
    dataset: 'asylum-decisions',
    asylum_iso3: ref.iso3,
    yearFrom: Math.max(yearFrom, yearTo - 4),
    yearTo,
  });
  const decisionAggregates = aggregateByYear(decisionRecords);

  await onProgress(4, TOTAL_STEPS, m.report.progress.demographics);
  const demo = await latestAggregates(ctx, 'demographics', { asylum_iso3: ref.iso3 });

  await onProgress(5, TOTAL_STEPS, m.report.progress.composing);
  const regression = linearRegression(refugeeSeries);
  const changes = yearOverYear(refugeeSeries);
  const lastChange = changes.at(-1);

  const sections: string[] = [
    m.report.title(name),
    '',
    m.report.generatedBy(citationText, tr.range(yearFrom, yearTo)),
    '',
    m.report.keyFigures,
  ];

  if (latest) {
    sections.push(
      tr.table(
        [m.common.indicator, m.common.peopleInYear(tr.year(latest.year))],
        Object.entries(latest.metrics).map(([k, v]) => [tr.metric(k), v]),
      ),
    );
  } else {
    sections.push(m.report.noDisplacement);
  }

  sections.push('', m.report.overTime);
  if (refugeeSeries.length > 0) {
    sections.push(
      tr.table(
        [m.common.year, m.common.refugees],
        refugeeSeries.map((p) => [tr.year(p.year), p.value]),
      ),
      '',
      (options.chart === 'svg'
        ? (input: ChartSpecInput) => `\`\`\`svg\n${toSvg(input)}\n\`\`\``
        : toMermaid)({
        title: m.charts.refugeesHostedIn(name),
        kind: 'line',
        xLabel: m.common.year,
        yLabel: m.common.refugees,
        series: [{ label: name, points: refugeeSeries.map((p) => ({ x: p.year, y: p.value })) }],
        ...tr.chartOptions(),
      }),
      '',
      m.report.trendLine(
        regression.slope >= 0 ? 'increasing' : 'decreasing',
        tr.num(Math.abs(Math.round(regression.slope))),
        tr.fixed(regression.r2, 2),
      ) +
        (lastChange && lastChange.changePct !== null
          ? m.report.lastChange(tr.pct(lastChange.changePct))
          : ''),
    );
  } else {
    sections.push(m.report.noRefugees);
  }

  sections.push('', m.report.whereFrom, topOriginsTable);

  sections.push('', tr.text(m.report.decisions));
  if (decisionAggregates.length > 0) {
    sections.push(
      tr.table(
        m.report.decisionHeaders,
        decisionAggregates.map((a) => [
          tr.year(a.year),
          a.metrics['dec_recognized'] ?? 0,
          a.metrics['dec_rejected'] ?? 0,
          a.metrics['dec_closed'] ?? 0,
          a.metrics['dec_total'] ?? 0,
        ]),
      ),
    );
  } else {
    sections.push(m.report.noDecisions);
  }

  sections.push('', m.report.demographics);
  if (demo) {
    const total = demo.metrics['total'] ?? 0;
    const fTotal = demo.metrics['f_total'] ?? 0;
    const children =
      (demo.metrics['f_0_4'] ?? 0) +
      (demo.metrics['f_5_11'] ?? 0) +
      (demo.metrics['f_12_17'] ?? 0) +
      (demo.metrics['m_0_4'] ?? 0) +
      (demo.metrics['m_5_11'] ?? 0) +
      (demo.metrics['m_12_17'] ?? 0);
    sections.push(
      m.report.asOf(tr.year(demo.year), tr.num(total)) +
        (total > 0
          ? m.report.shares(tr.pct((fTotal / total) * 100), tr.pct((children / total) * 100))
          : '.'),
    );
  } else {
    sections.push(m.report.noDemographics);
  }

  sections.push('', '---', m.report.methodNotes);

  return sections.join('\n');
}

export function registerReportTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'generate_country_report',
    {
      title: 'Generate country report',
      description:
        'Compose a full markdown humanitarian situation report for a country: key figures, refugee trend with an embedded chart, origins of hosted refugees, asylum decisions and demographics. Reports progress while assembling.',
      inputSchema: {
        country: countryInput,
        year_from: yearFromInput,
        year_to: yearToInput,
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        year_from: z.number(),
        year_to: z.number(),
        markdown: z.string(),
      },
    },
    async ({ country, year_from, year_to }, extra, tr) => {
      const ref = await resolveCountry(ctx, country);
      const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);

      const markdown = await buildCountryReport(
        ctx,
        ref,
        yearFrom,
        yearTo,
        (step, total, message) => reportProgress(extra, step, total, message),
        tr,
      );

      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          year_from: yearFrom,
          year_to: yearTo,
          markdown,
        },
      };
    },
  );
}
