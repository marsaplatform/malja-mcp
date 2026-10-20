import type { ChartSpecInput } from './series.js';

/** Colour cycle chosen for legibility on light and dark backgrounds. */
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
const BAND_FILL = ['rgba(37, 99, 235, 0.12)', 'rgba(37, 99, 235, 0.22)'];

/**
 * Build a ready-to-render Chart.js v4 configuration object.
 * Drop it into `new Chart(ctx, config)` or any Chart.js-compatible viewer.
 */
export function toChartJs(input: ChartSpecInput): Record<string, unknown> {
  const bands = input.bands ?? [];
  const markers = input.markers ?? [];
  const labels = [
    ...new Set([
      ...input.series.flatMap((s) => s.points.map((p) => p.x)),
      ...bands.flatMap((b) => b.points.map((p) => p.x)),
    ]),
  ].sort();
  // Category labels are strings so annotation positions (xMin/xMax) match them.
  const category = (v: number | string): string =>
    String(input.formatCategory ? input.formatCategory(v) : v);
  const rtl = input.direction === 'rtl';
  return {
    type: input.kind,
    data: {
      labels: labels.map(category),
      datasets: [
        // One floating-bar dataset per band: each year's [low, high] range is a
        // bar spanning the full category width, so every interval is a single
        // legend entry and the spec stays pure JSON (no legend-filter callback).
        ...bands.map((band, bi) => {
          const at = (x: number | string) => band.points.find((p) => p.x === x);
          return {
            type: 'bar',
            label: band.label,
            data: labels.map((x) => {
              const point = at(x);
              return point ? [point.low, point.high] : null;
            }),
            backgroundColor: BAND_FILL[bi % BAND_FILL.length],
            borderWidth: 0,
            borderSkipped: false,
            barPercentage: 1,
            categoryPercentage: 1,
            grouped: false,
            // Drawn behind the lines (higher order = drawn first).
            order: 10 + bands.length - bi,
          };
        }),
        ...input.series.map((series, i) => ({
          label: series.label,
          data: labels.map((x) => series.points.find((p) => p.x === x)?.y ?? null),
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length],
          fill: false,
          tension: 0.15,
          ...(series.dashed ? { borderDash: [6, 4] } : {}),
        })),
      ],
    },
    options: {
      responsive: true,
      ...(input.locale ? { locale: input.locale } : {}),
      plugins: {
        title: { display: true, text: input.title },
        legend: {
          display: input.series.length + bands.length > 1,
          ...(rtl ? { rtl: true, textDirection: 'rtl' } : {}),
        },
        ...(rtl ? { tooltip: { rtl: true, textDirection: 'rtl' } } : {}),
        // Changepoint rules for chartjs-plugin-annotation (ignored without the plugin).
        ...(markers.length > 0
          ? {
              annotation: {
                annotations: Object.fromEntries(
                  markers.map((marker, i) => [
                    `marker${i}`,
                    {
                      type: 'line',
                      xMin: category(marker.x),
                      xMax: category(marker.x),
                      borderColor: '#6b7280',
                      borderDash: [4, 3],
                      label: { display: true, content: marker.label, position: 'start' },
                    },
                  ]),
                ),
              },
            }
          : {}),
      },
      scales: {
        x: { title: { display: true, text: input.xLabel } },
        y: { title: { display: true, text: input.yLabel }, beginAtZero: true },
      },
    },
  };
}
