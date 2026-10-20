/**
 * Common shape all chart generators consume. `bands` and `markers` are
 * optional overlays; renderers without overlay support (Mermaid) ignore them.
 */

export interface Series {
  label: string;
  points: { x: number | string; y: number }[];
  /** Draw dashed (e.g. a projection). */
  dashed?: boolean;
}

/** A shaded range, e.g. a prediction interval. */
export interface Band {
  label: string;
  points: { x: number | string; low: number; high: number }[];
}

/** A vertical marker at a category, e.g. a detected changepoint. */
export interface Marker {
  x: number | string;
  label: string;
}

export type ChartKind = 'line' | 'bar';

export interface ChartSpecInput {
  title: string;
  kind: ChartKind;
  xLabel: string;
  yLabel: string;
  series: Series[];
  /** Shaded ranges drawn behind the series (prediction intervals). */
  bands?: Band[];
  /** Vertical markers (changepoints). */
  markers?: Marker[];
  /** Text direction of labels; "rtl" for Arabic output (default "ltr"). */
  direction?: 'ltr' | 'rtl';
  /** Locale tag for renderers that format numbers themselves (e.g. "ar"). */
  locale?: string;
  /** Compact tick formatter (default: 1.2M / 350k). */
  formatTick?: (value: number) => string;
  /** Formatter for category (x-axis) labels such as years. */
  formatCategory?: (value: number | string) => string;
}
