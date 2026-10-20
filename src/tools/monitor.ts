import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { LocalizedError } from '../errors.js';
import type { Translator } from '../i18n/index.js';
import { CountryRoleSchema, countryInput } from '../schemas/common.js';
import {
  detectEvents,
  latestYear,
  type MetricValues,
  type MonitorEvent,
  type MonitorSnapshot,
} from '../shared/monitor.js';
import {
  aggregateByYear,
  currentYear,
  datasetProvenance,
  defineTool,
  fetchAllRows,
  resolveCountry,
  roleFilter,
} from './common.js';

/** Population metrics watched by default (only those with data are reported). */
const DEFAULT_METRICS = [
  'refugees',
  'asylum_seekers',
  'idps',
  'returned_refugees',
  'returned_idps',
  'stateless',
  'ooc',
  'oip',
];

/** Server-side baselines live in the shared cache under this prefix. */
const SNAPSHOT_PREFIX = 'malja:monitor:v1:';

const SnapshotSchema = z.object({
  version: z.literal(1),
  key: z.string(),
  taken_at: z.string(),
  latest_year: z.number().int().nullable(),
  values: z.record(z.string(), z.record(z.string(), z.number())),
  event_ids: z.array(z.string()),
});

const EventSchema = z.object({
  id: z.string(),
  type: z.enum([
    'new_release',
    'revision',
    'jump',
    'threshold_crossing',
    'record_high',
    'record_low',
  ]),
  severity: z.enum(['info', 'notice', 'warning']),
  metric: z.string().nullable(),
  year: z.number(),
  baseline_year: z.number().nullable(),
  previous: z.number().nullable(),
  current: z.number().nullable(),
  change: z.number().nullable(),
  change_pct: z.number().nullable(),
  robust_z: z.number().nullable().optional(),
  threshold: z.number().optional(),
  direction: z.enum(['up', 'down']).optional(),
  new_since_snapshot: z.boolean(),
  message: z.string(),
});

const round1 = (v: number | null | undefined) =>
  v === null || v === undefined ? (v ?? null) : Math.round(v * 10) / 10;

function utcStamp(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** One localized sentence per event. */
function describe(event: MonitorEvent, tr: Translator): string {
  const m = tr.m.monitor;
  const metric = event.metric ? tr.metric(event.metric) : '';
  const num = (v: number | null) => (v === null ? '—' : tr.num(v));
  const pct = event.change_pct === null ? tr.m.common.na : tr.pct(event.change_pct);
  const year = tr.year(event.year);
  const base = event.baseline_year === null ? '' : tr.year(event.baseline_year);
  switch (event.type) {
    case 'new_release':
      return m.event.newRelease(year, base);
    case 'revision':
      return m.event.revision(metric, year, num(event.previous), num(event.current), pct);
    case 'jump': {
      if (event.previous === 0) return m.event.jumpFromZero(metric, year, num(event.current));
      const text = (event.direction === 'down' ? m.event.jumpDown : m.event.jumpUp)(
        metric,
        base,
        year,
        num(event.previous),
        num(event.current),
        pct,
      );
      return event.robust_z !== null &&
        event.robust_z !== undefined &&
        Math.abs(event.robust_z) >= 3.5
        ? `${text} ${m.event.unusual(tr.fixed(event.robust_z, 1))}`
        : text;
    }
    case 'threshold_crossing':
      return (event.direction === 'down' ? m.event.crossedBelow : m.event.crossedAbove)(
        metric,
        num(event.threshold ?? null),
        year,
        num(event.previous),
        num(event.current),
      );
    case 'record_high':
      return m.event.recordHigh(metric, year, num(event.current), base);
    case 'record_low':
      return m.event.recordLow(metric, year, num(event.current), base);
  }
}

export function registerMonitorTools(server: McpServer, ctx: AppContext): void {
  defineTool(
    server,
    ctx,
    'monitor_changes',
    {
      title: 'Monitor changes',
      description:
        "Check a country's UNHCR displacement figures for changes worth attention: compares the latest year with the previous one (significant jumps, threshold crossings, record highs/lows) and, against an earlier snapshot, detects new data releases and revisions of past years. Returns alert-ready events with stable ids and severities plus a snapshot to compare against next time. Read-only: never contacts anyone; the snapshot is kept in the server cache and/or returned to the caller.",
      inputSchema: {
        country: countryInput,
        role: CountryRoleSchema.optional(),
        metrics: z
          .array(z.string())
          .min(1)
          .max(12)
          .optional()
          .describe(
            'Metrics to watch (default: refugees, asylum_seekers, idps, returned_refugees, returned_idps, stateless, ooc, oip — those with data)',
          ),
        history_years: z
          .number()
          .int()
          .min(3)
          .max(30)
          .optional()
          .describe('Years of history to load for records and unusual-change scoring (default 10)'),
        jump_threshold_pct: z
          .number()
          .positive()
          .max(1000)
          .optional()
          .describe('Year-over-year change (%) flagged as a significant jump (default 25)'),
        min_change: z
          .number()
          .min(0)
          .optional()
          .describe('Ignore changes smaller than this many people (default 1000)'),
        thresholds: z
          .array(
            z.object({
              metric: z.string(),
              value: z.number(),
              direction: z.enum(['up', 'down', 'any']).optional(),
            }),
          )
          .max(20)
          .optional()
          .describe('Alert when a metric crosses a level between the previous and latest year'),
        snapshot: SnapshotSchema.optional().describe(
          'A `snapshot` returned by an earlier call — compare against it (takes precedence over the server-stored one)',
        ),
        use_stored_snapshot: z
          .boolean()
          .optional()
          .describe('Compare against the snapshot stored by the previous call (default true)'),
        store_snapshot: z
          .boolean()
          .optional()
          .describe('Save this result as the stored baseline for the next call (default true)'),
      },
      outputSchema: {
        country: z.string(),
        country_code: z.string(),
        role: z.string(),
        dataset: z.literal('population'),
        latest_year: z.number().nullable(),
        previous_year: z.number().nullable(),
        baseline: z.object({
          kind: z.enum(['supplied', 'stored', 'none']),
          taken_at: z.string().nullable(),
          latest_year: z.number().nullable(),
        }),
        metrics: z.array(
          z.object({
            metric: z.string(),
            previous: z.number().nullable(),
            latest: z.number().nullable(),
            change: z.number().nullable(),
            change_pct: z.number().nullable(),
          }),
        ),
        events: z.array(EventSchema),
        summary: z.object({
          total: z.number(),
          new: z.number(),
          warning: z.number(),
          notice: z.number(),
          info: z.number(),
          has_alerts: z.boolean(),
        }),
        snapshot: SnapshotSchema,
        snapshot_stored: z.boolean(),
        source: z.string(),
        citation: z.string(),
      },
    },
    async (args, _extra, tr) => {
      const m = tr.m.monitor;
      const role = args.role ?? 'asylum';
      const history = args.history_years ?? 10;
      const yearTo = currentYear();
      const yearFrom = yearTo - history + 1;
      const ref = await resolveCountry(ctx, args.country);
      const { source, citation } = await datasetProvenance(ctx, 'population');
      const name = tr.country(ref.iso3, ref.name);
      const key = `population:${source}:${ref.iso3}:${role}`;

      const { records } = await fetchAllRows(ctx, {
        dataset: 'population',
        ...roleFilter(role, ref.iso3),
        yearFrom,
        yearTo,
      });
      const aggregates = aggregateByYear(records);
      if (aggregates.length === 0) {
        return {
          content: [
            { type: 'text', text: m.noData(name, tr.side(role), tr.range(yearFrom, yearTo)) },
          ],
          isError: true,
        };
      }

      // Watched metrics: requested ones always; defaults only when they carry data.
      const requested = args.metrics;
      const values: MetricValues = {};
      for (const metric of requested ?? DEFAULT_METRICS) {
        const present = aggregates.some((a) => metric in a.metrics);
        const nonZero = aggregates.some((a) => (a.metrics[metric] ?? 0) !== 0);
        if (!present || (!requested && !nonZero)) continue;
        // Unreported cells ("-" upstream) are absent, not zero: skip those years.
        values[metric] = Object.fromEntries(
          aggregates
            .filter((a) => metric in a.metrics)
            .map((a) => [String(a.year), a.metrics[metric]!]),
        );
      }

      // Baseline: supplied snapshot > stored snapshot > none.
      let baseline: MonitorSnapshot | undefined;
      let baselineKind: 'supplied' | 'stored' | 'none' = 'none';
      if (args.snapshot) {
        if (args.snapshot.key !== key) {
          throw new LocalizedError((t) => t.m.monitor.snapshotMismatch(args.snapshot!.key, key));
        }
        baseline = args.snapshot;
        baselineKind = 'supplied';
      } else if (args.use_stored_snapshot ?? true) {
        const entry = await ctx.cache.get(SNAPSHOT_PREFIX + key);
        const parsed = entry ? SnapshotSchema.safeParse(JSON.parse(entry.body)) : undefined;
        if (parsed?.success) {
          baseline = parsed.data;
          baselineKind = 'stored';
        }
      }

      const events = detectEvents(values, baseline, {
        jumpThresholdPct: args.jump_threshold_pct ?? 25,
        minChange: args.min_change ?? 1000,
        thresholds: args.thresholds ?? [],
        idPrefix: `${ref.iso3}:${role}`,
      });
      const latest = latestYear(values);
      const previousYear = latest === null ? null : latest - 1;

      const takenAt = new Date().toISOString();
      const snapshot: MonitorSnapshot = {
        version: 1,
        key,
        taken_at: takenAt,
        latest_year: latest,
        values,
        event_ids: events.map((e) => e.id),
      };
      const store = args.store_snapshot ?? true;
      if (store) {
        await ctx.cache.set(SNAPSHOT_PREFIX + key, {
          body: JSON.stringify(snapshot),
          fetchedAt: Date.now(),
        });
      }

      const metricRows = Object.entries(values).map(([metric, byYear]) => {
        const prev = previousYear === null ? undefined : byYear[String(previousYear)];
        const last = latest === null ? undefined : byYear[String(latest)];
        const change = prev !== undefined && last !== undefined ? last - prev : null;
        const pct = change !== null && prev ? (change / Math.abs(prev)) * 100 : null;
        return {
          metric,
          previous: prev ?? null,
          latest: last ?? null,
          change,
          change_pct: round1(pct),
        };
      });

      const described = events.map((e) => ({
        ...e,
        change_pct: round1(e.change_pct),
        ...(e.robust_z !== undefined ? { robust_z: round1(e.robust_z) } : {}),
        message: describe(e, tr),
      }));
      const count = (s: MonitorEvent['severity']) => events.filter((e) => e.severity === s).length;
      const fresh = events.filter((e) => e.new_since_snapshot);
      const summary = {
        total: events.length,
        new: fresh.length,
        warning: count('warning'),
        notice: count('notice'),
        info: count('info'),
        has_alerts: fresh.some((e) => e.severity !== 'info'),
      };

      const baselineLine =
        baseline === undefined
          ? m.baselineNone
          : (baselineKind === 'supplied' ? m.baselineSupplied : m.baselineStored)(
              tr.text(utcStamp(baseline.taken_at)),
              baseline.latest_year === null ? tr.m.common.na : tr.year(baseline.latest_year),
            );

      const lines = [
        m.heading(name, tr.side(role)),
        '',
        latest === null || previousYear === null
          ? m.noLatest
          : m.latestLine(tr.year(latest), tr.year(previousYear)),
        baselineLine,
        '',
        `## ${m.eventsHeading}`,
        '',
        ...(described.length === 0
          ? [m.noEvents]
          : described.map(
              (e) =>
                `- **[${m.severity[e.severity]}]** ${e.message}${
                  baseline && !e.new_since_snapshot ? ` ${m.alreadySeen}` : ''
                }`,
            )),
        '',
      ];
      if (latest !== null && previousYear !== null && metricRows.length > 0) {
        lines.push(
          `## ${m.tableHeading}`,
          '',
          tr.table(
            [
              m.metricHeader,
              tr.year(previousYear),
              tr.year(latest),
              m.changeHeader,
              m.changePctHeader,
            ],
            metricRows.map((r) => [
              tr.metric(r.metric),
              r.previous,
              r.latest,
              r.change === null ? '—' : tr.signed(r.change),
              r.change_pct === null ? '—' : tr.pct(r.change_pct),
            ]),
          ),
          '',
        );
      }
      lines.push(
        store ? m.snapshotStored : m.snapshotNotStored,
        m.freshness,
        '',
        tr.sourceLine(citation, source),
      );

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          country: ref.name,
          country_code: ref.iso3,
          role,
          dataset: 'population' as const,
          latest_year: latest,
          previous_year: previousYear,
          baseline: {
            kind: baselineKind,
            taken_at: baseline?.taken_at ?? null,
            latest_year: baseline?.latest_year ?? null,
          },
          metrics: metricRows,
          events: described,
          summary,
          snapshot,
          snapshot_stored: store,
          source,
          citation,
        },
      };
    },
  );
}
