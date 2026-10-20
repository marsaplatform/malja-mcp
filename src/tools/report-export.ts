import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SERVER_NAME, SERVER_VERSION } from '../config.js';
import type { AppContext } from '../context.js';
import { LocalizedError } from '../errors.js';
import type { Translator } from '../i18n/index.js';
import { ExportStore } from '../render/export-store.js';
import { buildHtmlDocument } from '../render/html-report.js';
import { markdownToHtml } from '../render/markdown.js';
import { findBrowser, htmlToPdf } from '../render/pdf.js';
import { yearFromInput, yearToInput } from '../schemas/common.js';
import {
  datasetProvenance,
  defaultYearRange,
  defineTool,
  reportProgress,
  resolveCountry,
} from './common.js';
import type { ExtractionManifest } from './exports.js';
import { buildCountryReport } from './reports.js';

/**
 * export_report — formatted, print-ready HTML (and PDF) documents from the
 * country report or from any tool's markdown output.
 *
 *  - HTML: one self-contained file (embedded Zad font, inline CSS + SVG
 *    charts, A4 print stylesheet), RTL-correct for Arabic.
 *  - PDF: the same HTML printed by a locally installed Chromium-family
 *    browser (auto-detected / MALJA_CHROME_PATH); falls back to HTML with an
 *    explanation when none is available or MALJA_PDF=off.
 *  - Citations stay in the document body; the extraction manifest is
 *    appended as a table plus machine-readable JSON.
 *  - Results carry a resource link (export://{id}) by default so large files
 *    don't flood the conversation; inline: true embeds the file instead.
 */

const MAX_MARKDOWN = 400_000;

function utcDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Human date in the output language ("20 October 2026" / "20 أكتوبر 2026"). */
function longDate(iso: string, tr: Translator): string {
  const tag = tr.locale === 'ar' ? `ar-u-nu-${tr.digitStyle}` : 'en-GB';
  try {
    return new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(iso),
    );
  } catch {
    return utcDate(iso);
  }
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

function manifestRows(manifest: ExtractionManifest & { content_sha256?: string }, tr: Translator) {
  const label = (key: string) => tr.m.htmlReport.manifestFields[key] ?? key;
  const rows = [
    { label: label('tool'), value: manifest.tool },
    { label: label('arguments'), value: JSON.stringify(manifest.arguments) },
    { label: label('extracted_at'), value: manifest.extracted_at },
    { label: label('server'), value: manifest.server },
    { label: label('source'), value: manifest.source },
    { label: label('citation'), value: manifest.citation },
  ];
  if (manifest.content_sha256) {
    rows.push({ label: label('content_sha256'), value: manifest.content_sha256 });
  }
  return rows;
}

export function registerReportExportTools(server: McpServer, ctx: AppContext): void {
  const store = new ExportStore();

  server.registerResource(
    'export',
    new ResourceTemplate('export://{id}/{filename}', { list: undefined }),
    {
      title: 'Generated document',
      description:
        'A document produced by export_report (HTML or PDF), kept in server memory for one hour',
    },
    (uri, { id }) => {
      const item = store.get(String(id));
      if (!item) {
        throw new Error(
          `Export "${String(id)}" not found or expired (exports live for one hour) — call export_report again`,
        );
      }
      return {
        contents: [
          typeof item.data === 'string'
            ? { uri: uri.href, mimeType: item.mimeType, text: item.data }
            : { uri: uri.href, mimeType: item.mimeType, blob: item.data.toString('base64') },
        ],
      };
    },
  );

  defineTool(
    server,
    ctx,
    'export_report',
    {
      title: 'Export formatted report (HTML / PDF)',
      description:
        'Export a print-ready, self-contained document: the full country report (pass country) or any tool’s markdown output (pass markdown, e.g. from trend_analysis or durable_solutions). format "html" (default) = one file with embedded Arabic/Latin font, inline SVG charts, citations and the extraction manifest; "pdf" = the same rendered by a local headless Chrome/Chromium/Edge (falls back to HTML with an explanation if none is available). Arabic output (locale "ar") is right-to-left. Returns a resource link (export://…) unless inline is true.',
      inputSchema: {
        country: z
          .string()
          .optional()
          .describe(
            'Country for a full country report (name or ISO3). Omit when passing markdown.',
          ),
        year_from: yearFromInput,
        year_to: yearToInput,
        markdown: z
          .string()
          .max(MAX_MARKDOWN)
          .optional()
          .describe('Markdown to format instead of a country report (e.g. a tool’s text output)'),
        title: z.string().max(300).optional().describe('Document title (markdown mode)'),
        format: z.enum(['html', 'pdf']).optional().describe('Output format (default html)'),
        include_manifest: z
          .boolean()
          .optional()
          .describe('Append the extraction manifest (default true)'),
        inline: z
          .boolean()
          .optional()
          .describe(
            'Embed the file in the result instead of returning a resource link (default false)',
          ),
      },
      outputSchema: {
        format: z.enum(['html', 'pdf']),
        requested_format: z.enum(['html', 'pdf']),
        title: z.string(),
        filename: z.string(),
        mime_type: z.string(),
        bytes: z.number(),
        sha256: z.string(),
        uri: z.string(),
        locale: z.string(),
        pdf_engine: z.string().optional(),
        fallback_reason: z.string().optional(),
        manifest: z.record(z.unknown()).optional(),
      },
    },
    async (args, extra, tr) => {
      const { country, year_from, year_to, markdown, title, format, include_manifest, inline } =
        args;
      const requested = format ?? 'html';
      const extractedAt = new Date().toISOString();

      let body: string;
      let docTitle: string;
      let slug: string;
      let manifest: (ExtractionManifest & { content_sha256?: string }) | undefined;

      if (country) {
        const ref = await resolveCountry(ctx, country);
        const { yearFrom, yearTo } = defaultYearRange(year_from, year_to);
        body = await buildCountryReport(
          ctx,
          ref,
          yearFrom,
          yearTo,
          (step, total, message) => reportProgress(extra, step, total, message),
          tr,
          { chart: 'svg' },
        );
        docTitle = tr.m.report.title(tr.country(ref.iso3, ref.name)).replace(/^#\s*/, '');
        slug = ref.iso3.toLowerCase();
        const provenance = await datasetProvenance(ctx, 'population');
        manifest = {
          tool: 'export_report',
          arguments: {
            country,
            year_from: yearFrom,
            year_to: yearTo,
            format: requested,
            locale: tr.locale,
          },
          extracted_at: extractedAt,
          server: `${SERVER_NAME}/${SERVER_VERSION}`,
          source: provenance.source,
          citation: provenance.citation,
        };
      } else if (markdown && markdown.trim() !== '') {
        body = markdown;
        const firstHeading = /^#{1,3}\s+(.+)$/m.exec(markdown)?.[1];
        const firstLine = markdown.trim().split('\n')[0] ?? '';
        docTitle =
          (title ?? firstHeading ?? firstLine.replace(/[*_`#]/g, '').trim()).slice(0, 200) ||
          tr.m.htmlReport.defaultTitle;
        slug = 'document';
        const sha = createHash('sha256').update(markdown).digest('hex');
        manifest = {
          tool: 'export_report',
          arguments: { title: docTitle, format: requested, locale: tr.locale },
          extracted_at: extractedAt,
          server: `${SERVER_NAME}/${SERVER_VERSION}`,
          // Citations of client-supplied markdown live in its own source lines.
          source: 'client-supplied markdown',
          citation: '—',
          content_sha256: sha,
        };
      } else {
        throw new LocalizedError((t) => t.m.htmlReport.noInput);
      }

      const includeManifest = include_manifest ?? true;
      const bodyHtml = markdownToHtml(body, {
        // Only server-generated reports may inline SVG; client markdown is always escaped.
        trustedSvg: country !== undefined,
        mermaidNote: tr.m.htmlReport.mermaidNote,
      });
      const html = buildHtmlDocument({
        title: docTitle,
        bodyHtml,
        lang: tr.locale,
        dir: tr.dir,
        generator: `${SERVER_NAME}/${SERVER_VERSION}`,
        footer: tr.m.htmlReport.footer(
          `${SERVER_NAME} ${SERVER_VERSION}`,
          longDate(extractedAt, tr),
        ),
        ...(includeManifest && manifest
          ? {
              manifest: {
                heading: tr.m.htmlReport.manifestHeading,
                intro: tr.m.htmlReport.manifestIntro,
                rows: manifestRows(manifest, tr),
                json: manifest as unknown as Record<string, unknown>,
              },
            }
          : {}),
      });

      let data: string | Buffer = html;
      let actual: 'html' | 'pdf' = 'html';
      let engine: string | undefined;
      let fallbackReason: string | undefined;
      if (requested === 'pdf') {
        if (ctx.config.pdf === 'off') {
          fallbackReason = tr.m.htmlReport.reasons.disabled;
        } else {
          const browser = findBrowser(ctx.config.chromePath);
          if (!browser) {
            fallbackReason = tr.m.htmlReport.reasons.noBrowser;
          } else {
            try {
              data = await htmlToPdf(html, browser);
              actual = 'pdf';
              engine = browser.split(/[\\/]/).pop() ?? browser;
            } catch (err) {
              ctx.logger.warn('pdf rendering failed', {
                error: err instanceof Error ? err.message : String(err),
              });
              fallbackReason = tr.m.htmlReport.failed(
                err instanceof Error ? err.message.slice(0, 200) : String(err),
              );
            }
          }
        }
      }

      const mimeType = actual === 'pdf' ? 'application/pdf' : 'text/html';
      const filename = `malja-report-${slug}-${utcDate(extractedAt).replace(/-/g, '')}${tr.locale === 'en' ? '' : `-${tr.locale}`}.${actual}`;
      const bytes = Buffer.byteLength(data);
      const sha256 = createHash('sha256').update(data).digest('hex');
      const stored = store.put(filename, mimeType, data);
      const uri = `export://${stored.id}/${filename}`;

      const intro =
        (fallbackReason ? `${tr.m.htmlReport.pdfFallback(fallbackReason)}\n\n` : '') +
        (actual === 'pdf'
          ? tr.m.htmlReport.pdfReady(docTitle, tr.num(Number(kb(bytes))), engine ?? '')
          : tr.m.htmlReport.htmlReady(docTitle, tr.num(Number(kb(bytes)))));

      const content: CallToolResult['content'] = [
        { type: 'text', text: inline ? intro : `${intro}\n\n${tr.m.htmlReport.linkNote(uri)}` },
      ];
      if (inline) {
        content.push({
          type: 'resource',
          resource:
            typeof data === 'string'
              ? { uri, mimeType, text: data }
              : { uri, mimeType, blob: data.toString('base64') },
        });
      } else {
        content.push({
          type: 'resource_link',
          uri,
          name: filename,
          title: docTitle,
          mimeType,
          description: actual === 'pdf' ? 'PDF report' : 'Self-contained HTML report',
        });
      }

      return {
        content,
        structuredContent: {
          format: actual,
          requested_format: requested,
          title: docTitle,
          filename,
          mime_type: mimeType,
          bytes,
          sha256,
          uri,
          locale: tr.locale,
          ...(engine ? { pdf_engine: engine } : {}),
          ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
          ...(includeManifest && manifest
            ? { manifest: manifest as unknown as Record<string, unknown> }
            : {}),
        },
      };
    },
  );
}
