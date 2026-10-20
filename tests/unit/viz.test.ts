import { describe, expect, it } from 'vitest';
import type { NormalizedRecord } from '../../src/providers/types.js';
import { toChartJs } from '../../src/viz/chartjs.js';
import { objectsToCsv, toCsv } from '../../src/viz/csv.js';
import { toGeoJson } from '../../src/viz/geojson.js';
import { toMermaid } from '../../src/viz/mermaid.js';
import type { ChartSpecInput } from '../../src/viz/series.js';
import { toSvg } from '../../src/viz/svg.js';
import { formatNumber, markdownTable } from '../../src/viz/table.js';
import { toVegaLite } from '../../src/viz/vega.js';

const CHART: ChartSpecInput = {
  title: 'Refugees in "Egypt"',
  kind: 'line',
  xLabel: 'Year',
  yLabel: 'Refugees',
  series: [
    {
      label: 'Egypt',
      points: [
        { x: 2022, y: 100 },
        { x: 2023, y: 250 },
      ],
    },
    {
      label: 'Jordan',
      points: [{ x: 2023, y: 700 }],
    },
  ],
};

describe('csv', () => {
  it('escapes quotes, commas and newlines per RFC 4180', () => {
    const csv = toCsv(
      ['name', 'note'],
      [
        ['plain', 'no escaping'],
        ['has,comma', 'has "quotes"'],
        ['multi\nline', null],
      ],
    );
    expect(csv).toBe(
      'name,note\r\nplain,no escaping\r\n"has,comma","has ""quotes"""\r\n"multi\nline",\r\n',
    );
  });

  it('derives headers from the first object', () => {
    const csv = objectsToCsv([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
    expect(csv.startsWith('a,b\r\n1,x\r\n2,y')).toBe(true);
    expect(objectsToCsv([])).toBe('');
  });
});

describe('markdownTable', () => {
  it('renders headers, escapes pipes, formats numbers', () => {
    const table = markdownTable(['Country', 'People'], [['A|B', 1234567]]);
    expect(table).toContain('| Country | People |');
    expect(table).toContain('A\\|B');
    expect(table).toContain('1,234,567');
  });

  it('renders a placeholder when empty', () => {
    expect(markdownTable(['x'], [])).toBe('_No data._');
  });

  it('formatNumber handles decimals and non-finite values', () => {
    expect(formatNumber(12.345)).toBe('12.35');
    expect(formatNumber(Infinity)).toBe('—');
  });
});

describe('chart generators', () => {
  it('chartjs config carries every series aligned to the label union', () => {
    const config = toChartJs(CHART) as {
      type: string;
      data: { labels: number[]; datasets: { label: string; data: (number | null)[] }[] };
    };
    expect(config.type).toBe('line');
    expect(config.data.labels).toEqual(['2022', '2023']);
    expect(config.data.datasets).toHaveLength(2);
    // Jordan has no 2022 point → null keeps the axis aligned.
    expect(config.data.datasets[1]!.data).toEqual([null, 700]);
  });

  it('vega-lite spec declares schema and long-form values', () => {
    const spec = toVegaLite(CHART) as { $schema: string; data: { values: unknown[] } };
    expect(spec.$schema).toContain('vega-lite/v5');
    expect(spec.data.values).toHaveLength(3);
  });

  it('mermaid output is a fenced xychart block with quotes sanitized', () => {
    const text = toMermaid(CHART);
    expect(text.startsWith('```mermaid\nxychart-beta')).toBe(true);
    expect(text).toContain('title "Refugees in \'Egypt\'"');
    expect(text).toContain('line [100, 250]');
    expect(text.endsWith('```')).toBe(true);
  });

  it('svg output is standalone markup with escaped title and legend', () => {
    const svg = toSvg(CHART);
    expect(svg.startsWith('<svg xmlns=')).toBe(true);
    expect(svg).toContain('Refugees in &quot;Egypt&quot;');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('Jordan'); // legend for multi-series
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('svg renders bars for kind=bar', () => {
    const svg = toSvg({ ...CHART, kind: 'bar' });
    expect(svg).toContain('<rect');
    expect(svg).not.toContain('<polyline');
  });
});

describe('geojson', () => {
  const record = (code: string, country: string): NormalizedRecord => ({
    country,
    country_code: code,
    year: 2024,
    population: 10,
    metrics: { refugees: 10 },
    source: 'test',
    last_updated: 'now',
    dataset: 'population',
  });

  it('builds point features and reports countries without centroids', () => {
    const { featureCollection, skipped } = toGeoJson([
      record('EGY', 'Egypt'),
      record('XXX', 'Nowhere'),
      record('', 'All countries'),
    ]);
    const features = featureCollection['features'] as {
      geometry: { coordinates: [number, number] };
      properties: Record<string, unknown>;
    }[];
    expect(features).toHaveLength(1);
    // GeoJSON is [lon, lat].
    expect(features[0]!.geometry.coordinates[0]).toBeCloseTo(30.8);
    expect(features[0]!.geometry.coordinates[1]).toBeCloseTo(26.8);
    expect(features[0]!.properties['refugees']).toBe(10);
    expect(skipped).toEqual(['Nowhere', 'All countries']);
  });
});

describe('toVegaLite dashed projections', () => {
  it('maps the dashed flag explicitly so projections render dashed', () => {
    const spec = toVegaLite({
      ...CHART,
      series: [
        {
          label: 'observed',
          points: [
            { x: 2023, y: 1 },
            { x: 2024, y: 2 },
          ],
        },
        {
          label: 'projected',
          dashed: true,
          points: [
            { x: 2024, y: 2 },
            { x: 2025, y: 3 },
          ],
        },
      ],
    }) as {
      layer: { data: { values: { dashed?: boolean }[] }; encoding?: Record<string, unknown> }[];
    };
    const main = spec.layer.find((l) => l.encoding && 'strokeDash' in l.encoding)!;
    expect(main.data.values.map((v) => v.dashed)).toEqual([false, false, true, true]);
    expect(main.encoding!['strokeDash']).toMatchObject({
      scale: {
        domain: [false, true],
        range: [
          [1, 0],
          [6, 4],
        ],
      },
    });
  });
});

describe('toChartJs prediction bands and markers', () => {
  const spec = toChartJs({
    ...CHART,
    series: [
      {
        label: 'projected',
        dashed: true,
        points: [
          { x: 2024, y: 10 },
          { x: 2025, y: 12 },
        ],
      },
    ],
    bands: [
      { label: '95%', points: [{ x: 2025, low: 8, high: 16 }] },
      { label: '80%', points: [{ x: 2025, low: 10, high: 14 }] },
    ],
    markers: [{ x: 2024, label: 'break 2024' }],
  }) as {
    data: { labels: string[]; datasets: { type?: string; label: string; data: unknown[] }[] };
    options: { plugins: { annotation: { annotations: Record<string, { xMin: string }> } } };
  };

  it('emits one floating-bar dataset per band (one legend entry each)', () => {
    expect(spec.data.datasets.map((d) => [d.type, d.label])).toEqual([
      ['bar', '95%'],
      ['bar', '80%'],
      [undefined, 'projected'],
    ]);
    expect(spec.data.datasets[0]!.data).toEqual([null, [8, 16]]);
    expect(spec.data.datasets[1]!.data).toEqual([null, [10, 14]]);
  });

  it('positions markers on the (string) category labels', () => {
    expect(spec.data.labels).toEqual(['2024', '2025']);
    expect(spec.options.plugins.annotation.annotations['marker0']!.xMin).toBe('2024');
  });
});
