import type { ChartSpecInput } from './series.js';

/** Build a Vega-Lite v5 specification. */
export function toVegaLite(input: ChartSpecInput): Record<string, unknown> {
  const values = input.series.flatMap((series) =>
    series.points.map((p) => ({ x: p.x, y: p.y, series: series.label })),
  );
  const rtl = input.direction === 'rtl';
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: input.title,
    ...(rtl
      ? {
          config: {
            font: "'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
            title: { anchor: 'end' },
            legend: { orient: 'left' },
          },
        }
      : {}),
    width: 600,
    height: 320,
    data: { values },
    mark: input.kind === 'line' ? { type: 'line', point: true } : { type: 'bar' },
    encoding: {
      x: { field: 'x', type: 'ordinal', title: input.xLabel },
      y: { field: 'y', type: 'quantitative', title: input.yLabel },
      color:
        input.series.length > 1 ? { field: 'series', type: 'nominal', title: null } : undefined,
      xOffset: input.kind === 'bar' && input.series.length > 1 ? { field: 'series' } : undefined,
    },
  };
}
