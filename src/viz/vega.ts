import type { ChartSpecInput } from './series.js';

/**
 * Build a Vega-Lite v5 specification. Plain charts are a single-mark spec;
 * charts with overlays (prediction-interval bands, changepoint markers,
 * dashed projections) become a layered spec over the same axes.
 */
export function toVegaLite(input: ChartSpecInput): Record<string, unknown> {
  const values = input.series.flatMap((series) =>
    series.points.map((p) => ({
      x: p.x,
      y: p.y,
      series: series.label,
      ...(series.dashed ? { dashed: true } : {}),
    })),
  );
  const rtl = input.direction === 'rtl';
  const bands = input.bands ?? [];
  const markers = input.markers ?? [];
  const hasDashed = input.series.some((s) => s.dashed);

  const header = {
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
  };
  const mainMark = input.kind === 'line' ? { type: 'line', point: true } : { type: 'bar' };
  const mainEncoding = {
    x: { field: 'x', type: 'ordinal', title: input.xLabel },
    y: { field: 'y', type: 'quantitative', title: input.yLabel },
    color: input.series.length > 1 ? { field: 'series', type: 'nominal', title: null } : undefined,
    xOffset: input.kind === 'bar' && input.series.length > 1 ? { field: 'series' } : undefined,
  };

  if (bands.length === 0 && markers.length === 0 && !hasDashed) {
    return { ...header, data: { values }, mark: mainMark, encoding: mainEncoding };
  }

  const x = { field: 'x', type: 'ordinal', title: input.xLabel };
  const layer: Record<string, unknown>[] = [
    ...bands.map((band, i) => ({
      name: band.label,
      data: { values: band.points.map((p) => ({ x: p.x, low: p.low, high: p.high })) },
      mark: { type: 'area', opacity: i === 0 ? 0.15 : 0.25, color: '#2563eb' },
      encoding: {
        x,
        y: { field: 'low', type: 'quantitative', title: input.yLabel },
        y2: { field: 'high' },
      },
    })),
    {
      data: { values },
      mark: mainMark,
      encoding: {
        ...mainEncoding,
        ...(hasDashed ? { strokeDash: { field: 'dashed', type: 'nominal', legend: null } } : {}),
      },
    },
    ...(markers.length > 0
      ? [
          {
            data: { values: markers.map((m) => ({ x: m.x, label: m.label })) },
            mark: { type: 'rule', strokeDash: [4, 3], color: '#6b7280' },
            encoding: { x },
          },
          {
            data: { values: markers.map((m) => ({ x: m.x, label: m.label })) },
            mark: { type: 'text', align: rtl ? 'right' : 'left', dx: rtl ? -4 : 4, y: 8 },
            encoding: { x, text: { field: 'label' } },
          },
        ]
      : []),
  ];
  return { ...header, layer };
}
