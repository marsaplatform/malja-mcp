/**
 * Change detection for monitoring: compares the latest data against the
 * previous period and, when available, against an earlier snapshot of the
 * same series. Pure functions — no I/O — so the logic is easy to test and can
 * later drive scheduled alerts (events carry stable ids for de-duplication).
 */

export type MonitorEventType =
  'new_release' | 'revision' | 'jump' | 'threshold_crossing' | 'record_high' | 'record_low';

export type MonitorSeverity = 'info' | 'notice' | 'warning';

export interface MonitorEvent {
  /** Stable identifier: the same finding on the same data yields the same id. */
  id: string;
  type: MonitorEventType;
  severity: MonitorSeverity;
  /** Metric key, or null for dataset-level events (new_release). */
  metric: string | null;
  /** Data year the event refers to. */
  year: number;
  /** Comparison year (previous year, or the baseline's latest year). */
  baseline_year: number | null;
  previous: number | null;
  current: number | null;
  change: number | null;
  change_pct: number | null;
  /** Robust z-score of the latest year-over-year change against the series' own history. */
  robust_z?: number | null;
  threshold?: number;
  direction?: 'up' | 'down';
  /** False when the same event id was already present in the baseline snapshot. */
  new_since_snapshot: boolean;
}

/** Year → value per metric. Years are strings to stay JSON-friendly. */
export type MetricValues = Record<string, Record<string, number>>;

export interface MonitorSnapshot {
  version: 1;
  /** Identity of the monitored series: dataset:source:ISO3:role. */
  key: string;
  taken_at: string;
  latest_year: number | null;
  values: MetricValues;
  event_ids: string[];
}

export interface ThresholdRule {
  metric: string;
  value: number;
  direction?: 'up' | 'down' | 'any';
}

export interface DetectOptions {
  /** Year-over-year change (in %) that counts as a significant jump. */
  jumpThresholdPct: number;
  /** Ignore changes smaller than this many people (noise on small series). */
  minChange: number;
  thresholds: readonly ThresholdRule[];
  /** Prefix for event ids (e.g. "SDN:asylum"). */
  idPrefix: string;
}

/** |robust z| at or above this marks a change as unusual for the series. */
export const ROBUST_Z_UNUSUAL = 3.5;
/** Minimum earlier points for record and robust-z checks. */
const MIN_HISTORY = 4;

const SEVERITY_RANK: Record<MonitorSeverity, number> = { warning: 0, notice: 1, info: 2 };
const TYPE_RANK: Record<MonitorEventType, number> = {
  new_release: 0,
  threshold_crossing: 1,
  jump: 2,
  revision: 3,
  record_high: 4,
  record_low: 5,
};

function pctChange(previous: number, current: number): number | null {
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Robust z-score of the last year-over-year change against earlier changes
 * (median / MAD, scaled to σ). Null when history is too short or flat.
 */
export function robustChangeZ(series: readonly { year: number; value: number }[]): number | null {
  if (series.length < MIN_HISTORY + 2) return null;
  const changes = series.slice(1).map((p, i) => p.value - series[i]!.value);
  const last = changes.at(-1)!;
  const history = changes.slice(0, -1);
  const m = median(history);
  const mad = median(history.map((c) => Math.abs(c - m))) * 1.4826;
  if (mad === 0) return null;
  return (last - m) / mad;
}

/** Latest year present in any metric. */
export function latestYear(values: MetricValues): number | null {
  let latest: number | null = null;
  for (const byYear of Object.values(values))
    for (const year of Object.keys(byYear)) latest = Math.max(latest ?? 0, Number(year));
  return latest;
}

function seriesOf(byYear: Record<string, number>): { year: number; value: number }[] {
  return Object.entries(byYear)
    .map(([year, value]) => ({ year: Number(year), value }))
    .sort((a, b) => a.year - b.year);
}

/** Detect monitoring events in `current`, optionally against a baseline snapshot. */
export function detectEvents(
  current: MetricValues,
  baseline: Pick<MonitorSnapshot, 'latest_year' | 'values' | 'event_ids'> | undefined,
  options: DetectOptions,
): MonitorEvent[] {
  const events: Omit<MonitorEvent, 'new_since_snapshot'>[] = [];
  const latest = latestYear(current);
  if (latest === null) return [];
  const id = (...parts: (string | number)[]) => [options.idPrefix, ...parts].join(':');

  // 1. New release: the latest data year moved past the baseline's.
  if (baseline?.latest_year != null && latest > baseline.latest_year) {
    events.push({
      id: id('new_release', latest),
      type: 'new_release',
      severity: 'notice',
      metric: null,
      year: latest,
      baseline_year: baseline.latest_year,
      previous: null,
      current: null,
      change: null,
      change_pct: null,
    });
  }

  for (const [metric, byYear] of Object.entries(current)) {
    const series = seriesOf(byYear);

    // 2. Revisions: a year the baseline already had now carries another value.
    const before = baseline?.values[metric];
    if (before) {
      for (const point of series) {
        const old = before[String(point.year)];
        if (old === undefined || old === point.value) continue;
        const change = point.value - old;
        const pct = pctChange(old, point.value);
        const significant =
          Math.abs(change) >= options.minChange || (pct !== null && Math.abs(pct) >= 1);
        events.push({
          id: id('revision', metric, point.year, point.value),
          type: 'revision',
          severity: significant ? 'notice' : 'info',
          metric,
          year: point.year,
          baseline_year: point.year,
          previous: old,
          current: point.value,
          change,
          change_pct: pct,
        });
      }
    }

    const last = series.at(-1);
    if (!last || last.year !== latest) continue;

    // 3. Records within the monitored window.
    const earlier = series.slice(0, -1).map((p) => p.value);
    if (earlier.length >= MIN_HISTORY) {
      const max = Math.max(...earlier);
      const min = Math.min(...earlier);
      const base = {
        metric,
        year: last.year,
        baseline_year: series[0]!.year,
        previous: null,
        current: last.value,
        change: null,
        change_pct: null,
        severity: 'info' as const,
      };
      if (last.value > max && last.value >= options.minChange)
        events.push({
          ...base,
          id: id('record_high', metric, last.year),
          type: 'record_high',
          previous: max,
        });
      else if (last.value < min && max >= options.minChange)
        events.push({
          ...base,
          id: id('record_low', metric, last.year),
          type: 'record_low',
          previous: min,
        });
    }

    // Period comparison: latest year vs the year before.
    const prev = series.at(-2);
    if (!prev || prev.year !== latest - 1) continue;
    const change = last.value - prev.value;
    const pct = pctChange(prev.value, last.value);
    const z = robustChangeZ(series);

    // 4. Significant jump.
    const bigEnough = Math.abs(change) >= options.minChange;
    const fromZero = prev.value === 0 && last.value > 0;
    const pctJump = pct !== null && Math.abs(pct) >= options.jumpThresholdPct;
    const unusual = z !== null && Math.abs(z) >= ROBUST_Z_UNUSUAL;
    if (bigEnough && (fromZero || pctJump || unusual)) {
      events.push({
        id: id('jump', metric, last.year),
        type: 'jump',
        severity:
          fromZero || (pct !== null && Math.abs(pct) >= 2 * options.jumpThresholdPct)
            ? 'warning'
            : 'notice',
        metric,
        year: last.year,
        baseline_year: prev.year,
        previous: prev.value,
        current: last.value,
        change,
        change_pct: pct,
        robust_z: z,
        direction: change >= 0 ? 'up' : 'down',
      });
    }

    // 5. Threshold crossings.
    for (const rule of options.thresholds) {
      if (rule.metric !== metric) continue;
      const up = prev.value < rule.value && last.value >= rule.value;
      const down = prev.value >= rule.value && last.value < rule.value;
      const dir = rule.direction ?? 'any';
      if ((up && dir !== 'down') || (down && dir !== 'up')) {
        events.push({
          id: id('threshold', metric, rule.value, up ? 'up' : 'down', last.year),
          type: 'threshold_crossing',
          severity: 'warning',
          metric,
          year: last.year,
          baseline_year: prev.year,
          previous: prev.value,
          current: last.value,
          change,
          change_pct: pct,
          threshold: rule.value,
          direction: up ? 'up' : 'down',
        });
      }
    }
  }

  const seen = new Set(baseline?.event_ids ?? []);
  return events
    .map((e) => ({ ...e, new_since_snapshot: !seen.has(e.id) }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
        (a.metric ?? '').localeCompare(b.metric ?? '') ||
        a.year - b.year,
    );
}

/** Event ids kept in a merged snapshot (most recent last). */
const MAX_EVENT_IDS = 1000;

/**
 * Fold a new snapshot into an older one of the same series: newer values win
 * year by year, metrics and years only in the older one are kept, and event
 * ids accumulate so already-reported events stay "seen".
 */
export function mergeSnapshots(
  older: MonitorSnapshot | undefined,
  newer: MonitorSnapshot,
): MonitorSnapshot {
  if (!older || older.key !== newer.key) return newer;
  const values: MetricValues = {};
  for (const metric of new Set([...Object.keys(older.values), ...Object.keys(newer.values)])) {
    values[metric] = { ...older.values[metric], ...newer.values[metric] };
  }
  const ids = [...new Set([...older.event_ids, ...newer.event_ids])];
  return {
    ...newer,
    latest_year:
      older.latest_year === null
        ? newer.latest_year
        : Math.max(older.latest_year, newer.latest_year ?? older.latest_year),
    values,
    event_ids: ids.slice(-MAX_EVENT_IDS),
  };
}
