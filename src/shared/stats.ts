/**
 * Small, dependency-free statistics helpers behind the trend, forecast and
 * anomaly tools. All functions are pure.
 */

export interface YearValue {
  year: number;
  value: number;
}

export interface Regression {
  slope: number;
  intercept: number;
  /** Coefficient of determination, 0..1 (0 when undefined, e.g. < 2 points). */
  r2: number;
}

export function linearRegression(points: readonly YearValue[]): Regression {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.value ?? 0, r2: 0 };

  const meanX = points.reduce((s, p) => s + p.year, 0) / n;
  const meanY = points.reduce((s, p) => s + p.value, 0) / n;

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (const p of points) {
    ssXY += (p.year - meanX) * (p.value - meanY);
    ssXX += (p.year - meanX) ** 2;
    ssYY += (p.value - meanY) ** 2;
  }
  if (ssXX === 0) return { slope: 0, intercept: meanY, r2: 0 };

  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r2 = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY);
  return { slope, intercept, r2 };
}

/** Naive linear projection. Values are floored at zero (populations). */
export function forecastLinear(points: readonly YearValue[], yearsAhead: number): YearValue[] {
  if (points.length === 0 || yearsAhead <= 0) return [];
  const { slope, intercept } = linearRegression(points);
  const lastYear = Math.max(...points.map((p) => p.year));
  const projected: YearValue[] = [];
  for (let i = 1; i <= yearsAhead; i++) {
    const year = lastYear + i;
    projected.push({ year, value: Math.max(0, Math.round(slope * year + intercept)) });
  }
  return projected;
}

export interface YearChange {
  year: number;
  value: number;
  change: number;
  /** Percent change vs the previous year; null when the previous value is 0. */
  changePct: number | null;
}

/** Year-over-year deltas for a series sorted by year. */
export function yearOverYear(points: readonly YearValue[]): YearChange[] {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  const changes: YearChange[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    changes.push({
      year: curr.year,
      value: curr.value,
      change: curr.value - prev.value,
      changePct: prev.value === 0 ? null : ((curr.value - prev.value) / prev.value) * 100,
    });
  }
  return changes;
}

export interface Anomaly extends YearChange {
  /** How many standard deviations this year's change sits from the mean change. */
  zScore: number;
}

/**
 * Flag years whose year-over-year change deviates more than `threshold`
 * standard deviations from the series' mean change.
 */
export function detectAnomalies(points: readonly YearValue[], threshold = 2): Anomaly[] {
  const changes = yearOverYear(points);
  if (changes.length < 3) return [];

  const mean = changes.reduce((s, c) => s + c.change, 0) / changes.length;
  const variance = changes.reduce((s, c) => s + (c.change - mean) ** 2, 0) / changes.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return [];

  return changes
    .map((c) => ({ ...c, zScore: (c.change - mean) / stddev }))
    .filter((c) => Math.abs(c.zScore) >= threshold);
}

/** Compound annual growth rate (%), null when undefined for the series. */
export function cagr(points: readonly YearValue[]): number | null {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.year === last.year || first.value <= 0 || last.value <= 0) {
    return null;
  }
  const years = last.year - first.year;
  return ((last.value / first.value) ** (1 / years) - 1) * 100;
}

// ---------------------------------------------------------------------------
// Changepoint detection
// ---------------------------------------------------------------------------

export type ChangepointModel = 'linear' | 'mean';

export interface Segment {
  /** First and last year of the segment (inclusive). */
  from: number;
  to: number;
  /** Least-squares line over the segment (slope 0 for the mean model). */
  slope: number;
  intercept: number;
  mean: number;
}

export interface Changepoint {
  /** First year of the new regime. */
  year: number;
  /**
   * Jump at `year` relative to the previous regime's line extrapolated into
   * that year (for the mean model: difference of segment means).
   */
  levelShift: number;
  slopeBefore: number;
  slopeAfter: number;
  meanBefore: number;
  meanAfter: number;
}

export interface ChangepointResult {
  model: ChangepointModel;
  changepoints: Changepoint[];
  segments: Segment[];
  /** Robust noise scale used for the penalty, in the series' units. */
  sigma: number;
  /** Penalty per additional segment, in squared series units. */
  penalty: number;
}

export interface ChangepointOptions {
  /** "linear" (default): breaks in level and/or slope; "mean": level shifts only. */
  model?: ChangepointModel;
  /** Minimum points per segment (default 3 for "linear", 2 for "mean"). */
  minSegment?: number;
  /** Multiplier on the BIC-type penalty (default 1; larger = fewer breaks). */
  penaltyScale?: number;
  /**
   * Noise floor as a fraction of the series' median absolute level (default
   * 0.02): humanitarian counts are rarely precise to better than ~2%, and a
   * perfectly smooth series must not yield spurious breaks.
   */
  noiseFloor?: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median absolute deviation from zero-centred differences, as a σ estimate. */
function robustSigma(values: readonly number[], model: ChangepointModel): number {
  if (model === 'mean') {
    const d1 = values.slice(1).map((v, i) => v - values[i]!);
    // Var(Δy) = 2σ² for iid noise.
    return median(d1.map(Math.abs)) / 0.6745 / Math.SQRT2;
  }
  const d2 = values.slice(2).map((v, i) => v - 2 * values[i + 1]! + values[i]!);
  // Var(Δ²y) = 6σ² for iid noise; linear trends cancel out.
  return median(d2.map(Math.abs)) / 0.6745 / Math.sqrt(6);
}

/**
 * Exact penalised changepoint detection by Optimal Partitioning (the exact
 * dynamic programme that PELT accelerates — series here are ≤ ~75 yearly
 * points, so the O(n²) search is instant and pruning buys nothing).
 *
 * Cost: residual sum of squares of a least-squares line (model "linear") or
 * of the segment mean (model "mean"). Penalty per extra segment:
 * p·σ²·ln(n) (BIC/SIC-type, p = parameters per segment incl. the break),
 * with σ estimated robustly from differences (MAD) and floored at
 * `noiseFloor` × median level. Pure; inputs need not be sorted.
 */
export function detectChangepoints(
  points: readonly YearValue[],
  options: ChangepointOptions = {},
): ChangepointResult {
  const model = options.model ?? 'linear';
  const minSegment = Math.max(1, options.minSegment ?? (model === 'linear' ? 3 : 2));
  const sorted = [...points].sort((a, b) => a.year - b.year);
  const n = sorted.length;
  const empty: ChangepointResult = { model, changepoints: [], segments: [], sigma: 0, penalty: 0 };
  if (n === 0) return empty;

  // Rescale for numerical stability (counts reach 1e7; squares 1e14+).
  const scale = Math.max(1, ...sorted.map((p) => Math.abs(p.value)));
  const x = sorted.map((p) => p.year - sorted[0]!.year);
  const y = sorted.map((p) => p.value / scale);

  const prefix = (f: (i: number) => number): number[] => {
    const out = [0];
    for (let i = 0; i < n; i++) out.push(out[i]! + f(i));
    return out;
  };
  const Sx = prefix((i) => x[i]!);
  const Sy = prefix((i) => y[i]!);
  const Sxx = prefix((i) => x[i]! * x[i]!);
  const Sxy = prefix((i) => x[i]! * y[i]!);
  const Syy = prefix((i) => y[i]! * y[i]!);

  /** Fit over indices [a, b). */
  const fit = (a: number, b: number) => {
    const m = b - a;
    const sx = Sx[b]! - Sx[a]!;
    const sy = Sy[b]! - Sy[a]!;
    const cxx = Sxx[b]! - Sxx[a]! - (sx * sx) / m;
    const cxy = Sxy[b]! - Sxy[a]! - (sx * sy) / m;
    const cyy = Syy[b]! - Syy[a]! - (sy * sy) / m;
    const mean = sy / m;
    if (model === 'mean' || cxx <= 0) {
      return { slope: 0, intercept: mean, mean, rss: Math.max(0, cyy) };
    }
    const slope = cxy / cxx;
    const intercept = mean - slope * (sx / m);
    return { slope, intercept, mean, rss: Math.max(0, cyy - (cxy * cxy) / cxx) };
  };

  const sigmaScaled = Math.max(
    robustSigma(y, model),
    (options.noiseFloor ?? 0.02) * median(y.map(Math.abs)),
  );
  const paramsPerSegment = model === 'linear' ? 3 : 2;
  const penalty =
    (options.penaltyScale ?? 1) * paramsPerSegment * sigmaScaled ** 2 * Math.log(Math.max(n, 2));

  // F[t] = optimal penalised cost of y[0..t); last[t] = start of last segment.
  const F: number[] = new Array<number>(n + 1).fill(Infinity);
  const last: number[] = new Array<number>(n + 1).fill(0);
  F[0] = -penalty;
  for (let t = minSegment; t <= n; t++) {
    for (let s = 0; s <= t - minSegment; s++) {
      if (s !== 0 && s < minSegment) continue;
      if (!Number.isFinite(F[s]!)) continue;
      const candidate = F[s]! + fit(s, t).rss + penalty;
      // Strict "<" prefers fewer, earlier-closed segments on ties.
      if (candidate < F[t]! - 1e-12) {
        F[t] = candidate;
        last[t] = s;
      }
    }
  }

  const bounds: number[] = [];
  for (let t = n; t > 0; t = last[t]!) bounds.unshift(last[t]!);
  const starts = Number.isFinite(F[n]!) ? bounds : [0];
  const ends = [...starts.slice(1), n];

  const segments: Segment[] = starts.map((a, i) => {
    const b = ends[i]!;
    const f = fit(a, b);
    // Back to original units; intercept expressed at year 0 like linearRegression.
    const slope = f.slope * scale;
    const interceptAtX0 = f.intercept * scale;
    return {
      from: sorted[a]!.year,
      to: sorted[b - 1]!.year,
      slope,
      intercept: interceptAtX0 - slope * sorted[0]!.year,
      mean: f.mean * scale,
    };
  });

  const changepoints: Changepoint[] = segments.slice(1).map((after, i) => {
    const before = segments[i]!;
    const year = after.from;
    const levelShift =
      model === 'linear'
        ? after.slope * year + after.intercept - (before.slope * year + before.intercept)
        : after.mean - before.mean;
    return {
      year,
      levelShift,
      slopeBefore: before.slope,
      slopeAfter: after.slope,
      meanBefore: before.mean,
      meanAfter: after.mean,
    };
  });

  return {
    model,
    changepoints,
    segments,
    sigma: sigmaScaled * scale,
    penalty: penalty * scale ** 2,
  };
}

// ---------------------------------------------------------------------------
// Student-t quantiles and prediction intervals
// ---------------------------------------------------------------------------

/** ln Γ(x) — Lanczos approximation (g = 7, n = 9), |error| < 1e-13. */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Numerical Recipes betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** CDF of Student's t with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - tail : tail;
}

/** Quantile of Student's t (bisection on the exact CDF; |error| < 1e-10). */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -studentTQuantile(1 - p, df);
  let lo = 0;
  let hi = 1;
  while (studentTCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface IntervalForecast extends YearValue {
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
}

/**
 * Naive linear projection with OLS **prediction** intervals:
 * ŷ ± t(1−α/2, n−2) · s · √(1 + 1/n + (x₀ − x̄)² / Sxx).
 * Assumes the straight-line model with independent, homoscedastic residuals;
 * the intervals cover year-to-year noise only, not shocks. Values and lower
 * bounds are floored at zero (populations). Needs ≥ 3 points.
 */
export function forecastLinearIntervals(
  points: readonly YearValue[],
  yearsAhead: number,
): IntervalForecast[] {
  const n = points.length;
  if (n < 3 || yearsAhead <= 0) return [];
  const { slope, intercept } = linearRegression(points);
  const meanX = points.reduce((s, p) => s + p.year, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.year - meanX) ** 2, 0);
  const rss = points.reduce((s, p) => s + (p.value - (slope * p.year + intercept)) ** 2, 0);
  const se = Math.sqrt(rss / (n - 2));
  const t80 = studentTQuantile(0.9, n - 2);
  const t95 = studentTQuantile(0.975, n - 2);
  const lastYear = Math.max(...points.map((p) => p.year));

  const out: IntervalForecast[] = [];
  for (let i = 1; i <= yearsAhead; i++) {
    const year = lastYear + i;
    const fitted = slope * year + intercept;
    const spread = se * Math.sqrt(1 + 1 / n + (sxx > 0 ? (year - meanX) ** 2 / sxx : 0));
    const clamp = (v: number) => Math.max(0, Math.round(v));
    out.push({
      year,
      value: clamp(fitted),
      lower80: clamp(fitted - t80 * spread),
      upper80: clamp(fitted + t80 * spread),
      lower95: clamp(fitted - t95 * spread),
      upper95: clamp(fitted + t95 * spread),
    });
  }
  return out;
}
