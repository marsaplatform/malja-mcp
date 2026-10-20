import { describe, expect, it } from 'vitest';
import {
  detectEvents,
  latestYear,
  mergeSnapshots,
  robustChangeZ,
} from '../../src/shared/monitor.js';
import type { MetricValues } from '../../src/shared/monitor.js';

const opts = { jumpThresholdPct: 25, minChange: 1000, thresholds: [], idPrefix: 'XXX:asylum' };

const steady = (from: number, values: number[]) =>
  Object.fromEntries(values.map((v, i) => [String(from + i), v]));

describe('detectEvents', () => {
  it('finds nothing in a steady series without a baseline', () => {
    const values: MetricValues = { refugees: steady(2018, [100_000, 102_000, 104_000, 106_000]) };
    expect(detectEvents(values, undefined, opts)).toEqual([]);
  });

  it('flags significant jumps (percent or from zero) and ignores small absolute changes', () => {
    const values: MetricValues = {
      refugees: steady(2021, [10_000, 10_500, 20_000]),
      returned_idps: steady(2021, [0, 0, 5_000]),
      stateless: steady(2021, [100, 120, 400]),
    };
    const events = detectEvents(values, undefined, opts);
    expect(events.map((e) => [e.type, e.metric, e.severity])).toEqual([
      ['jump', 'refugees', 'warning'],
      ['jump', 'returned_idps', 'warning'],
    ]);
    expect(events[0]).toMatchObject({
      id: 'XXX:asylum:jump:refugees:2023',
      year: 2023,
      baseline_year: 2022,
      previous: 10_500,
      current: 20_000,
      direction: 'up',
      new_since_snapshot: true,
    });
    expect(events[0]!.change_pct).toBeCloseTo(90.48, 1);
    expect(events[1]!.change_pct).toBeNull();
  });

  it('a 30% move is a notice; twice the threshold is a warning', () => {
    const values: MetricValues = { idps: steady(2022, [100_000, 70_000]) };
    expect(detectEvents(values, undefined, opts)[0]).toMatchObject({
      severity: 'notice',
      direction: 'down',
    });
  });

  it('flags changes unusual for the series even below the % threshold', () => {
    const values: MetricValues = {
      refugees: steady(
        2015,
        [1_000_000, 1_010_000, 1_018_000, 1_029_000, 1_040_000, 1_049_000, 1_200_000],
      ),
    };
    const [jump, record] = detectEvents(values, undefined, opts);
    expect(jump).toMatchObject({ type: 'jump', severity: 'notice' });
    expect(jump!.robust_z!).toBeGreaterThan(3.5);
    expect(record).toMatchObject({ type: 'record_high', previous: 1_049_000, baseline_year: 2015 });
  });

  it('threshold crossings respect direction', () => {
    const values: MetricValues = { idps: steady(2023, [11_500_000, 9_100_000]) };
    const rule = (direction: 'up' | 'down' | 'any') => ({
      ...opts,
      jumpThresholdPct: 99,
      thresholds: [{ metric: 'idps', value: 10_000_000, direction }],
    });
    expect(detectEvents(values, undefined, rule('up'))).toEqual([]);
    const [crossing] = detectEvents(values, undefined, rule('down'));
    expect(crossing).toMatchObject({
      type: 'threshold_crossing',
      severity: 'warning',
      threshold: 10_000_000,
      direction: 'down',
      id: 'XXX:asylum:threshold:idps:10000000:down:2024',
    });
    expect(detectEvents(values, undefined, rule('any'))).toHaveLength(1);
  });

  it('against a snapshot: new release, revisions, and already-seen events', () => {
    const current: MetricValues = { refugees: steady(2021, [10_000, 10_500, 21_000, 22_000]) };
    const baseline = {
      latest_year: 2023,
      values: { refugees: steady(2021, [10_000, 10_400, 21_000]) },
      event_ids: ['XXX:asylum:jump:refugees:2024'],
    };
    const events = detectEvents(current, baseline, opts);
    expect(events.map((e) => [e.type, e.year, e.severity, e.new_since_snapshot])).toEqual([
      ['new_release', 2024, 'notice', true],
      ['revision', 2022, 'info', true],
    ]);
    expect(events[0]).toMatchObject({ metric: null, baseline_year: 2023 });
    expect(events[1]).toMatchObject({ previous: 10_400, current: 10_500, change: 100 });

    // A larger revision is a notice; an event already in the baseline is not new.
    const later: MetricValues = {
      refugees: steady(2021, [10_000, 10_500, 21_000, 22_000, 50_000]),
    };
    const again = detectEvents(
      later,
      {
        latest_year: 2025,
        values: { refugees: steady(2021, [10_000, 12_000]) },
        event_ids: ['XXX:asylum:jump:refugees:2025'],
      },
      opts,
    );
    expect(again.find((e) => e.type === 'jump')).toMatchObject({ new_since_snapshot: false });
    expect(again.find((e) => e.type === 'revision')).toMatchObject({
      severity: 'notice',
      year: 2022,
    });
  });
});

describe('detectEvents gaps', () => {
  it('records do not need the previous year; YoY checks do', () => {
    const values: MetricValues = {
      refugees: { '2018': 10_000, '2019': 11_000, '2020': 12_000, '2021': 13_000, '2023': 40_000 },
    };
    const events = detectEvents(values, undefined, opts);
    expect(events.map((e) => e.type)).toEqual(['record_high']);
  });
});

describe('helpers', () => {
  it('mergeSnapshots keeps older metrics/years and accumulates event ids', () => {
    const older = {
      version: 1 as const,
      key: 'k',
      taken_at: 't0',
      latest_year: 2025,
      values: { a: { '2020': 1, '2025': 2 }, b: { '2025': 5 } },
      event_ids: ['x'],
    };
    const newer = { ...older, taken_at: 't1', values: { a: { '2025': 3 } }, event_ids: ['y'] };
    expect(mergeSnapshots(older, newer)).toEqual({
      ...newer,
      values: { a: { '2020': 1, '2025': 3 }, b: { '2025': 5 } },
      event_ids: ['x', 'y'],
    });
    expect(mergeSnapshots({ ...older, key: 'other' }, newer)).toBe(newer);
    expect(mergeSnapshots(undefined, newer)).toBe(newer);
  });

  it('robustChangeZ needs history and variation', () => {
    expect(robustChangeZ([1, 2, 3].map((v, i) => ({ year: 2000 + i, value: v })))).toBeNull();
    const flat = [0, 10, 20, 30, 40, 50, 60].map((v, i) => ({ year: 2000 + i, value: v }));
    expect(robustChangeZ(flat)).toBeNull();
  });

  it('latestYear spans metrics', () => {
    expect(latestYear({ a: { '2020': 1 }, b: { '2023': 0 } })).toBe(2023);
    expect(latestYear({})).toBeNull();
  });
});
