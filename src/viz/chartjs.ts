import type { ChartSpecInput } from './series.js';

/** Colour cycle chosen for legibility on light and dark backgrounds. */
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

/**
 * Build a ready-to-render Chart.js v4 configuration object.
 * Drop it into `new Chart(ctx, config)` or any Chart.js-compatible viewer.
 */
export function toChartJs(input: ChartSpecInput): Record<string, unknown> {
  const labels = [...new Set(input.series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const rtl = input.direction === 'rtl';
  return {
    type: input.kind,
    data: {
      labels: input.formatCategory ? labels.map(input.formatCategory) : labels,
      datasets: input.series.map((series, i) => ({
        label: series.label,
        data: labels.map((x) => series.points.find((p) => p.x === x)?.y ?? null),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length],
        fill: false,
        tension: 0.15,
      })),
    },
    options: {
      responsive: true,
      ...(input.locale ? { locale: input.locale } : {}),
      plugins: {
        title: { display: true, text: input.title },
        legend: {
          display: input.series.length > 1,
          ...(rtl ? { rtl: true, textDirection: 'rtl' } : {}),
        },
        ...(rtl ? { tooltip: { rtl: true, textDirection: 'rtl' } } : {}),
      },
      scales: {
        x: { title: { display: true, text: input.xLabel } },
        y: { title: { display: true, text: input.yLabel }, beginAtZero: true },
      },
    },
  };
}
