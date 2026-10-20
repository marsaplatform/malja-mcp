import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape, z } from 'zod';
import type { AppContext } from '../context.js';
import { CountryNotFoundError, LocalizedError, toUserMessage } from '../errors.js';
import { LocaleSchema, isLocale, translator } from '../i18n/index.js';
import type { Translator } from '../i18n/index.js';
import type { CountryRef, DatasetId, ListQuery, NormalizedRecord } from '../providers/types.js';

/**
 * Plumbing shared by every tool: registration with consistent error handling
 * and analytics, country resolution, and per-year aggregation of records.
 */

type ToolExtra = Parameters<ToolCallback<ZodRawShape>>[1];

export interface ToolConfig<I extends ZodRawShape, O extends ZodRawShape> {
  title: string;
  description: string;
  inputSchema: I;
  outputSchema?: O;
}

/** Translator for a tool call: the per-call `locale` wins over MALJA_LOCALE. */
export function translatorFor(ctx: AppContext, locale: unknown): Translator {
  return translator(isLocale(locale) ? locale : ctx.config.locale, ctx.config.digits);
}

/**
 * Register a tool with the platform conventions baked in:
 *  - read-only/open-world annotations (this server never mutates anything)
 *  - an optional `locale` input ("en" | "ar") on every tool; the handler
 *    receives the matching {@link Translator} for all human-readable text
 *  - errors become `isError` results with an LLM-actionable message, in the
 *    caller's locale
 *  - every call is timed into analytics for the dashboard
 */
export function defineTool<I extends ZodRawShape, O extends ZodRawShape>(
  server: McpServer,
  ctx: AppContext,
  name: string,
  config: ToolConfig<I, O>,
  handler: (
    args: z.objectOutputType<I, z.ZodTypeAny>,
    extra: ToolExtra,
    tr: Translator,
  ) => Promise<CallToolResult>,
): void {
  const inputSchema = { ...config.inputSchema, locale: LocaleSchema.optional() } as I;
  const wrapped = (async (
    args: z.objectOutputType<I, z.ZodTypeAny>,
    extra: ToolExtra,
  ): Promise<CallToolResult> => {
    const started = Date.now();
    const tr = translatorFor(ctx, (args as { locale?: unknown }).locale);
    try {
      const result = await handler(args, extra, tr);
      const elapsed = Date.now() - started;
      ctx.analytics.recordToolCall(name, elapsed, result.isError === true);
      ctx.logger.info(`tools/call ${name}`, { ms: elapsed, isError: result.isError === true });
      return result;
    } catch (err) {
      ctx.analytics.recordToolCall(name, Date.now() - started, true);
      ctx.logger.warn(`tool ${name} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { content: [{ type: 'text', text: toUserMessage(err, tr) }], isError: true };
    }
  }) as ToolCallback<I>;

  server.registerTool(
    name,
    {
      ...config,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrapped,
  );
}

/** Send a progress notification when the client asked for one. */
export async function reportProgress(
  extra: ToolExtra,
  progress: number,
  total: number,
  message: string,
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  await extra.sendNotification({
    method: 'notifications/progress',
    params: { progressToken, progress, total, message },
  });
}

/** Resolve a country query or throw with suggestions the model can act on. */
export async function resolveCountry(ctx: AppContext, query: string): Promise<CountryRef> {
  const provider = ctx.registry.primary();
  const matches = await provider.search({ query, limit: 3 });
  const best = matches[0];
  if (best && best.score >= 0.6) return best;
  throw new CountryNotFoundError(
    query,
    matches.map((m) => m.name),
  );
}

export type CountryRole = 'asylum' | 'origin';

/** Build the ListQuery country filter for a role. */
export function roleFilter(role: CountryRole, iso3: string): Partial<ListQuery> {
  return role === 'asylum' ? { asylum_iso3: iso3 } : { origin_iso3: iso3 };
}

const MAX_AGGREGATION_PAGES = 3;
const AGGREGATION_PAGE_SIZE = 1000;

/**
 * Fetch every row matching `query` (bounded at 3 × 1000 rows) — used by tools
 * that aggregate rather than paginate. Truncation is logged and surfaced.
 */
export async function fetchAllRows(
  ctx: AppContext,
  query: Omit<ListQuery, 'page' | 'limit'>,
): Promise<{ records: NormalizedRecord[]; truncated: boolean }> {
  const provider = await ctx.registry.forDataset(query.dataset);
  const records: NormalizedRecord[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_AGGREGATION_PAGES; page++) {
    const result = await provider.list({ ...query, page, limit: AGGREGATION_PAGE_SIZE });
    records.push(...result.items);
    const maxPages = result.maxPages ?? 1;
    if (page >= maxPages) break;
    if (page === MAX_AGGREGATION_PAGES && maxPages > MAX_AGGREGATION_PAGES) {
      truncated = true;
      ctx.logger.warn('aggregation truncated', { dataset: query.dataset, maxPages });
    }
  }
  return { records, truncated };
}

export interface YearAggregate {
  year: number;
  population: number;
  metrics: Record<string, number>;
}

/** Sum records per year (asylum datasets return one row per sub-category). */
export function aggregateByYear(records: readonly NormalizedRecord[]): YearAggregate[] {
  const byYear = new Map<number, YearAggregate>();
  for (const record of records) {
    const aggregate = byYear.get(record.year) ?? {
      year: record.year,
      population: 0,
      metrics: {},
    };
    aggregate.population += record.population;
    for (const [key, value] of Object.entries(record.metrics)) {
      aggregate.metrics[key] = (aggregate.metrics[key] ?? 0) + value;
    }
    byYear.set(record.year, aggregate);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** Pull one metric (or the headline population) out of year aggregates. */
export function metricSeries(
  aggregates: readonly YearAggregate[],
  metric: string | undefined,
): { year: number; value: number }[] {
  return aggregates.map((aggregate) => ({
    year: aggregate.year,
    value: metric ? (aggregate.metrics[metric] ?? 0) : aggregate.population,
  }));
}

/** Provenance for output payloads: the serving provider's id and citation. */
export async function datasetProvenance(
  ctx: AppContext,
  dataset: DatasetId,
): Promise<{ source: string; citation: string }> {
  const provider = await ctx.registry.forDataset(dataset);
  const meta = await provider.metadata();
  return {
    source: provider.id,
    citation: meta.datasets.find((d) => d.id === dataset)?.citation ?? meta.name,
  };
}

export function currentYear(): number {
  return new Date().getFullYear();
}

/** Default range: the last `span` years ending this year. */
export function defaultYearRange(
  yearFrom: number | undefined,
  yearTo: number | undefined,
  span = 10,
): { yearFrom: number; yearTo: number } {
  const to = yearTo ?? currentYear();
  const from = yearFrom ?? to - (span - 1);
  if (from > to) {
    throw new LocalizedError((tr) => tr.m.errors.yearRange(tr.year(from), tr.year(to)));
  }
  return { yearFrom: from, yearTo: to };
}

/**
 * The most recent year with data for a dataset/country. Probes the last three
 * years so "latest" tools stay cheap; UNHCR publishes with up to a year's lag.
 */
export async function latestAggregates(
  ctx: AppContext,
  dataset: DatasetId,
  filter: Partial<ListQuery> = {},
): Promise<YearAggregate | undefined> {
  const to = currentYear();
  const { records } = await fetchAllRows(ctx, {
    dataset,
    ...filter,
    yearFrom: to - 2,
    yearTo: to,
  });
  return aggregateByYear(records).at(-1);
}
