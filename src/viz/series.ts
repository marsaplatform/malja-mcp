/** Common shape all chart generators consume. */

export interface Series {
  label: string;
  points: { x: number | string; y: number }[];
}

export type ChartKind = 'line' | 'bar';

export interface ChartSpecInput {
  title: string;
  kind: ChartKind;
  xLabel: string;
  yLabel: string;
  series: Series[];
  /** Text direction of labels; "rtl" for Arabic output (default "ltr"). */
  direction?: 'ltr' | 'rtl';
  /** Locale tag for renderers that format numbers themselves (e.g. "ar"). */
  locale?: string;
  /** Compact tick formatter (default: 1.2M / 350k). */
  formatTick?: (value: number) => string;
  /** Formatter for category (x-axis) labels such as years. */
  formatCategory?: (value: number | string) => string;
}
