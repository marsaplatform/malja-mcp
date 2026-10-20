import type { Band, ChartSpecInput } from './series.js';

/**
 * Dependency-free SVG chart renderer (line and grouped bar). Deliberately
 * minimal: axes, gridlines, legend, series. Output is a standalone <svg>
 * string suitable for embedding in HTML or saving as a .svg file.
 */

const WIDTH = 720;
const HEIGHT = 400;
const LEGEND_STRIP = 24;
const MARGIN = { top: 48, right: 24, bottom: 56, left: 84 };
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
const BAND_COLOR = '#2563eb';
/** Opacity per band: first (outer, e.g. 95%) lightest. */
const BAND_OPACITY = ['0.12', '0.22'];

export function toSvg(input: ChartSpecInput): string {
  const bands = input.bands ?? [];
  const markers = input.markers ?? [];
  const labels = [
    ...new Set([
      ...input.series.flatMap((s) => s.points.map((p) => p.x)),
      ...bands.flatMap((b) => b.points.map((p) => p.x)),
    ]),
  ].sort();
  const values = [
    ...input.series.flatMap((s) => s.points.map((p) => p.y)),
    ...bands.flatMap((b) => b.points.map((p) => p.high)),
  ];
  const maxY = Math.max(1, ...values);

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  // A legend gets its own strip below the axis title instead of overlapping it.
  const hasLegend = input.series.length + bands.length > 1;
  const totalH = HEIGHT + (hasLegend ? LEGEND_STRIP : 0);
  const xStep = plotW / Math.max(1, labels.length);
  const yScale = (v: number): number => MARGIN.top + plotH - (v / maxY) * plotH;
  const xCenter = (i: number): number => MARGIN.left + xStep * i + xStep / 2;

  const rtl = input.direction === 'rtl';
  const tick = input.formatTick ?? compactNumber;
  const category = input.formatCategory ?? ((v: number | string) => String(v));
  // RTL: Arabic-capable font stack and bidi-aware text. The time axis keeps
  // running left→right (the convention in Arabic statistical publications);
  // only labels are right-to-left.
  const fontFamily = rtl
    ? "'Noto Sans Arabic', 'Noto Naskh Arabic', 'Segoe UI', Tahoma, sans-serif"
    : 'ui-monospace, monospace';
  const textDir = rtl ? ' direction="rtl" unicode-bidi="embed"' : '';
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${totalH}" font-family="${fontFamily}" font-size="12"${rtl ? ' direction="rtl"' : ''}>`,
    `<rect width="${WIDTH}" height="${totalH}" fill="white"/>`,
    `<text x="${WIDTH / 2}" y="24" text-anchor="middle" font-size="16" font-weight="bold"${textDir}>${escapeXml(input.title)}</text>`,
  ];

  // Horizontal gridlines + y-axis tick labels.
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const value = (maxY / ticks) * t;
    const y = yScale(value);
    parts.push(
      `<line x1="${MARGIN.left}" y1="${y}" x2="${WIDTH - MARGIN.right}" y2="${y}" stroke="#e5e7eb"/>`,
      `<text x="${MARGIN.left - 8}" y="${y + 4}" text-anchor="end" fill="#6b7280">${escapeXml(tick(value))}</text>`,
    );
  }

  // X-axis labels (thinned when crowded).
  const labelEvery = Math.ceil(labels.length / 12);
  labels.forEach((label, i) => {
    if (i % labelEvery !== 0) return;
    parts.push(
      `<text x="${xCenter(i)}" y="${HEIGHT - MARGIN.bottom + 20}" text-anchor="middle" fill="#374151">${escapeXml(category(label))}</text>`,
    );
  });

  // Bands (prediction intervals) behind everything else; wider bands first.
  bands.forEach((band, bi) => {
    const pts = labels
      .map((x, i) => ({ i, point: band.points.find((p) => p.x === x) }))
      .filter((e): e is { i: number; point: Band['points'][number] } => e.point !== undefined);
    if (pts.length === 0) return;
    const upper = pts.map((e) => `${xCenter(e.i)},${yScale(e.point.high)}`);
    const lower = [...pts].reverse().map((e) => `${xCenter(e.i)},${yScale(e.point.low)}`);
    parts.push(
      `<polygon points="${[...upper, ...lower].join(' ')}" fill="${BAND_COLOR}" fill-opacity="${BAND_OPACITY[bi % BAND_OPACITY.length]}" stroke="none"/>`,
    );
  });

  // Markers (changepoints): dashed rule on the boundary before the category.
  for (const marker of markers) {
    const i = labels.indexOf(marker.x);
    if (i < 0) continue;
    const mx = MARGIN.left + xStep * i;
    parts.push(
      `<line x1="${mx}" y1="${MARGIN.top}" x2="${mx}" y2="${MARGIN.top + plotH}" stroke="#6b7280" stroke-dasharray="4 3"/>`,
      `<text x="${mx + (rtl ? -4 : 4)}" y="${MARGIN.top + 12}" font-size="11" fill="#4b5563" text-anchor="${rtl ? 'end' : 'start'}"${textDir}>${escapeXml(marker.label)}</text>`,
    );
  }

  // Series.
  input.series.forEach((series, si) => {
    const color = PALETTE[si % PALETTE.length];
    if (input.kind === 'line') {
      const coords = labels
        .map((x, i) => {
          const point = series.points.find((p) => p.x === x);
          return point ? `${xCenter(i)},${yScale(point.y)}` : undefined;
        })
        .filter((c): c is string => c !== undefined);
      parts.push(
        `<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"${series.dashed ? ' stroke-dasharray="6 4"' : ''}/>`,
      );
      for (const coord of coords) {
        const [cx, cy] = coord.split(',');
        parts.push(`<circle cx="${cx}" cy="${cy}" r="3.5" fill="${color}"/>`);
      }
    } else {
      const groupWidth = (xStep * 0.7) / input.series.length;
      labels.forEach((x, i) => {
        const point = series.points.find((p) => p.x === x);
        if (!point) return;
        const barX = xCenter(i) - (xStep * 0.7) / 2 + si * groupWidth;
        const barY = yScale(point.y);
        parts.push(
          `<rect x="${barX}" y="${barY}" width="${Math.max(1, groupWidth - 2)}" height="${MARGIN.top + plotH - barY}" fill="${color}"/>`,
        );
      });
    }
  });

  // Legend: series, then bands.
  const legend = [
    ...input.series.map((series, si) => ({
      label: series.label,
      swatch: `fill="${PALETTE[si % PALETTE.length]}"`,
    })),
    ...bands.map((band, bi) => ({
      label: band.label,
      swatch: `fill="${BAND_COLOR}" fill-opacity="${BAND_OPACITY[bi % BAND_OPACITY.length]}"`,
    })),
  ];
  if (hasLegend) {
    legend.forEach((entry, si) => {
      const ly = totalH - 10;
      if (rtl) {
        // Legend flows right→left: swatch on the right, label to its left.
        const rx = WIDTH - MARGIN.right - si * 160;
        parts.push(
          `<rect x="${rx - 12}" y="${ly - 10}" width="12" height="12" ${entry.swatch}/>`,
          `<text x="${rx - 18}" y="${ly}" fill="#374151" text-anchor="start"${textDir}>${escapeXml(entry.label)}</text>`,
        );
        return;
      }
      const lx = MARGIN.left + si * 160;
      parts.push(
        `<rect x="${lx}" y="${ly - 10}" width="12" height="12" ${entry.swatch}/>`,
        `<text x="${lx + 18}" y="${ly}" fill="#374151">${escapeXml(entry.label)}</text>`,
      );
    });
  }

  // Axis labels.
  parts.push(
    `<text x="${WIDTH / 2}" y="${HEIGHT - MARGIN.bottom + 40}" text-anchor="middle" fill="#111827"${textDir}>${escapeXml(input.xLabel)}</text>`,
    `<text x="20" y="${HEIGHT / 2}" text-anchor="middle" transform="rotate(-90 20 ${HEIGHT / 2})" fill="#111827"${textDir}>${escapeXml(input.yLabel)}</text>`,
    '</svg>',
  );
  return parts.join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}
