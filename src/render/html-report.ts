import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './markdown.js';

/**
 * Self-contained, print-ready HTML documents: one file, no external requests
 * (fonts embedded as data URIs, CSS inline, charts as inline SVG), A4 print
 * stylesheet, RTL-correct for Arabic (`<html dir="rtl" lang="ar">`, logical
 * CSS properties, bidi-isolated numbers).
 *
 * Typeface: Zad (SIL OFL 1.1, Arabic + Latin, a web-optimized derivative of
 * IBM Plex Sans Arabic) — the same face as the project site. License text
 * ships next to the font files in assets/fonts/OFL.txt.
 */

export interface ManifestRow {
  label: string;
  value: string;
}

export interface HtmlReportInput {
  title: string;
  /** Rendered body (from markdownToHtml). */
  bodyHtml: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  /** Generator string, e.g. "malja-mcp/0.7.0". */
  generator: string;
  footer: string;
  manifest?: {
    heading: string;
    intro: string;
    rows: ManifestRow[];
    /** Machine-readable copy embedded as application/json. */
    json: Record<string, unknown>;
  };
  /** Embed the Zad font (default true). Without it the CSS falls back to system fonts. */
  embedFont?: boolean;
}

/** assets/fonts relative to this module — same depth from src/render and dist/render. */
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

let fontFaceCache: string | undefined;

/** @font-face rules with the Zad woff2 files as data URIs ('' when unavailable). */
export function embeddedFontFaces(): string {
  if (fontFaceCache !== undefined) return fontFaceCache;
  const faces: string[] = [];
  for (const [file, weight] of [
    ['Zad-Regular.woff2', 400],
    ['Zad-Bold.woff2', 700],
  ] as const) {
    try {
      const data = readFileSync(join(FONT_DIR, file)).toString('base64');
      faces.push(
        `@font-face{font-family:'Zad';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}`,
      );
    } catch {
      // Font files missing (unusual install): fall back to system fonts.
    }
  }
  // Cache only a complete result, so a transient read failure is retried.
  const css = faces.join('\n');
  if (faces.length === 2) fontFaceCache = css;
  return css;
}

const STYLES = `
:root{--ink:#141c2e;--soft:#5b6274;--rule:#ddd4c0;--paper:#fdfaf3;--accent:#0e7568;--band:#f6f1e7}
*{box-sizing:border-box}
html{font-size:11pt}
body{margin:0;color:var(--ink);background:#fff;line-height:1.6;
  font-family:'Zad','Noto Naskh Arabic','Noto Sans Arabic','IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;
  font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main,header,footer{max-width:190mm;margin-inline:auto;padding-inline:8mm}
header{border-block-end:3px solid var(--accent);padding-block:10mm 4mm;margin-block-end:6mm}
header .brand{color:var(--accent);font-weight:700;letter-spacing:.02em;font-size:.9rem}
h1{font-size:1.9rem;line-height:1.25;margin:.2em 0 .1em}
h2{font-size:1.3rem;margin:1.6em 0 .5em;padding-block-end:.2em;border-block-end:1px solid var(--rule);break-after:avoid}
h3{font-size:1.1rem;margin:1.2em 0 .4em;break-after:avoid}
p{margin:.5em 0}
blockquote{margin:1em 0;padding:.6em 1em;background:var(--band);border-inline-start:4px solid var(--accent);color:var(--soft)}
table{width:100%;border-collapse:collapse;margin:.8em 0 1.2em;font-size:.92rem;break-inside:auto}
thead{display:table-header-group}
tr{break-inside:avoid}
th,td{padding:.35em .6em;border-block-end:1px solid var(--rule);text-align:start;vertical-align:top}
th{background:var(--band);font-weight:700}
th.num{text-align:right}
td.num{text-align:right;white-space:nowrap}
td.num>*,td.num{unicode-bidi:plaintext}
em{color:var(--soft)}
code{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;font-size:.88em;direction:ltr;unicode-bidi:isolate}
pre{direction:ltr;text-align:left;background:var(--band);padding:.8em;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-size:.8rem}
figure{margin:1em 0;break-inside:avoid}
figure.chart svg{width:100%;height:auto;display:block}
figure.chart svg,figure.chart svg text{font-family:'Zad','Noto Naskh Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif}
figcaption{color:var(--soft);font-size:.85rem}
a{color:var(--accent);text-decoration:none;word-break:break-all}
hr{border:0;border-block-start:1px solid var(--rule);margin:1.5em 0}
section.manifest{margin-block-start:8mm;padding:4mm 5mm;border:1px solid var(--rule);background:var(--paper);break-inside:avoid;font-size:.88rem}
section.manifest h2{margin-block-start:0;font-size:1.05rem}
section.manifest th{width:28%;background:transparent}
section.manifest td{word-break:break-word}
footer{color:var(--soft);font-size:.8rem;border-block-start:1px solid var(--rule);margin-block:8mm 10mm;padding-block-start:3mm}
@page{size:A4;margin:16mm 14mm 18mm}
@media print{
  html{font-size:10pt}
  main,header,footer{max-width:none;padding-inline:0}
  header{padding-block-start:0}
  a{color:inherit}
}
`;

/** Assemble the full HTML document. */
export function buildHtmlDocument(input: HtmlReportInput): string {
  const fonts = input.embedFont === false ? '' : embeddedFontFaces();
  const manifest = input.manifest;
  const manifestHtml = manifest
    ? [
        `<section class="manifest" aria-labelledby="malja-manifest-heading">`,
        `<h2 id="malja-manifest-heading">${escapeHtml(manifest.heading)}</h2>`,
        `<p>${escapeHtml(manifest.intro)}</p>`,
        '<table><tbody>',
        ...manifest.rows.map(
          (row) =>
            `<tr><th scope="row">${escapeHtml(row.label)}</th><td><bdi>${escapeHtml(row.value)}</bdi></td></tr>`,
        ),
        '</tbody></table>',
        '</section>',
        // JSON copy for machines; "<" escaped so it can never close the script element.
        `<script type="application/json" id="malja-manifest">${JSON.stringify(manifest.json).replace(/</g, '\\u003c')}</script>`,
      ].join('\n')
    : '';

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.lang)}" dir="${input.dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="${escapeHtml(input.generator)}">`,
    `<title>${escapeHtml(input.title)}</title>`,
    `<style>${fonts}\n${STYLES}</style>`,
    '</head>',
    '<body>',
    `<header><div class="brand">Malja MCP · ملجأ</div></header>`,
    `<main>\n${input.bodyHtml}\n${manifestHtml}\n</main>`,
    `<footer>${escapeHtml(input.footer)}</footer>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
