import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectChangepoints,
  forecastLinearIntervals,
  incompleteBeta,
  linearRegression,
  studentTCdf,
  studentTQuantile,
} from '../../src/shared/stats.js';
import type { YearValue } from '../../src/shared/stats.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'unhcr');

/** A metric series from a recorded UNHCR /population/ fixture. */
function fixtureSeries(file: string, metric: string): YearValue[] {
  const envelope = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as {
    items: Record<string, unknown>[];
  };
  return envelope.items.map((row) => ({ year: Number(row['year']), value: Number(row[metric]) }));
}

describe('Student t distribution', () => {
  it('matches published two-sided critical values', () => {
    // Standard t-table values.
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.7062, 3);
    expect(studentTQuantile(0.975, 2)).toBeCloseTo(4.3027, 3);
    expect(studentTQuantile(0.975, 8)).toBeCloseTo(2.306, 3);
    expect(studentTQuantile(0.9, 8)).toBeCloseTo(1.3968, 3);
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.0423, 3);
    expect(studentTQuantile(0.025, 8)).toBeCloseTo(-2.306, 3);
    expect(studentTQuantile(0.5, 5)).toBe(0);
  });

  it('CDF and incomplete beta are consistent', () => {
    expect(studentTCdf(0, 7)).toBeCloseTo(0.5, 12);
    expect(studentTCdf(studentTQuantile(0.9, 12), 12)).toBeCloseTo(0.9, 9);
    expect(incompleteBeta(1, 1, 0.3)).toBeCloseTo(0.3, 12); // uniform
    expect(incompleteBeta(2, 3, 0)).toBe(0);
    expect(incompleteBeta(2, 3, 1)).toBe(1);
  });
});

describe('forecastLinearIntervals', () => {
  const points: YearValue[] = [
    { year: 2016, value: 100 },
    { year: 2017, value: 130 },
    { year: 2018, value: 125 },
    { year: 2019, value: 160 },
    { year: 2020, value: 170 },
  ];

  it('reproduces the textbook OLS prediction interval', () => {
    const [p] = forecastLinearIntervals(points, 1);
    const { slope, intercept } = linearRegression(points);
    const n = points.length;
    const meanX = 2018;
    const sxx = 10;
    const rss = points.reduce((s, q) => s + (q.value - (slope * q.year + intercept)) ** 2, 0);
    const se = Math.sqrt(rss / (n - 2));
    const fitted = slope * 2021 + intercept;
    const half95 = 3.182446 * se * Math.sqrt(1 + 1 / n + (2021 - meanX) ** 2 / sxx); // t(0.975, 3)
    expect(p!.year).toBe(2021);
    expect(p!.value).toBe(Math.round(fitted));
    expect(p!.lower95).toBe(Math.round(fitted - half95));
    expect(p!.upper95).toBe(Math.round(fitted + half95));
  });

  it('nests 80% inside 95%, widens with the horizon and floors at zero', () => {
    const out = forecastLinearIntervals(points, 3);
    for (const p of out) {
      expect(p.lower95).toBeLessThanOrEqual(p.lower80);
      expect(p.upper95).toBeGreaterThanOrEqual(p.upper80);
      expect(p.lower80).toBeLessThanOrEqual(p.value);
    }
    expect(out[2]!.upper95 - out[2]!.lower95).toBeGreaterThan(out[0]!.upper95 - out[0]!.lower95);
    const falling = forecastLinearIntervals(
      [
        { year: 2020, value: 300 },
        { year: 2021, value: 180 },
        { year: 2022, value: 90 },
      ],
      2,
    );
    expect(falling.every((p) => p.lower95 >= 0 && p.value >= 0)).toBe(true);
  });

  it('needs at least three points', () => {
    expect(forecastLinearIntervals(points.slice(0, 2), 2)).toEqual([]);
  });
});

describe('detectChangepoints', () => {
  it('finds nothing in a perfectly linear series', () => {
    const line = Array.from({ length: 12 }, (_, i) => ({ year: 2010 + i, value: 1e5 + i * 1e4 }));
    expect(detectChangepoints(line).changepoints).toEqual([]);
    expect(detectChangepoints(line, { model: 'mean' }).changepoints.length).toBeGreaterThan(0);
  });

  it('locates a synthetic level shift and reports its size', () => {
    const noise = [3, -2, 1, -1, 2, -3, 0, 2, -1, 1, -2, 3];
    const series = noise.map((e, i) => ({
      year: 2010 + i,
      value: 1_000 + i * 10 + e * 5 + (i >= 7 ? 5_000 : 0),
    }));
    const result = detectChangepoints(series);
    expect(result.changepoints.map((c) => c.year)).toEqual([2017]);
    expect(result.changepoints[0]!.levelShift).toBeGreaterThan(4_500);
    expect(result.changepoints[0]!.levelShift).toBeLessThan(5_500);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ from: 2010, to: 2016 });
  });

  it('respects the minimum segment length: a jump in the last two years is dated ≤ n−3', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      year: 2015 + i,
      value: i < 8 ? 1_000 + i : 50_000,
    }));
    const result = detectChangepoints(series);
    expect(result.changepoints.map((c) => c.year)).toEqual([2022]);
    expect(result.segments.every((s) => s.to - s.from + 1 >= 3)).toBe(true);
  });

  it('finds the 2023 Sudan war in UNHCR IDP figures (recorded fixture)', () => {
    const idps = fixtureSeries('population-sudan-origin-2010-2025.json', 'idps');
    const result = detectChangepoints(idps);
    const war = result.changepoints.find((c) => c.year === 2023);
    expect(war).toBeDefined();
    expect(war!.levelShift).toBeGreaterThan(5_000_000);
  });

  it('finds the 2012 Syria outflow and the 2013 Syrian arrivals in Egypt (recorded fixtures)', () => {
    const syria = detectChangepoints(
      fixtureSeries('population-syria-origin-2005-2020.json', 'refugees'),
    );
    expect(syria.changepoints[0]!.year).toBe(2012);
    const egypt = detectChangepoints(fixtureSeries('population-egypt-2010-2025.json', 'refugees'));
    expect(egypt.changepoints[0]!.year).toBe(2013);
    expect(egypt.changepoints[0]!.levelShift).toBeGreaterThan(100_000);
  });

  it('is order-independent and handles tiny inputs', () => {
    const idps = fixtureSeries('population-sudan-origin-2010-2025.json', 'idps');
    expect(detectChangepoints([...idps].reverse())).toEqual(detectChangepoints(idps));
    expect(detectChangepoints([]).changepoints).toEqual([]);
    expect(detectChangepoints([{ year: 2020, value: 5 }]).segments).toHaveLength(1);
  });
});
