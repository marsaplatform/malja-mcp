import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { findBrowser } from '../../src/render/pdf.js';
import { createServer } from '../../src/server.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * export_report end to end through MCP against the mock provider — no network.
 * The real-PDF case runs only where a Chromium-family browser is installed.
 */

type Structured = {
  format: 'html' | 'pdf';
  requested_format: 'html' | 'pdf';
  title: string;
  filename: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  uri: string;
  locale: string;
  pdf_engine?: string;
  fallback_reason?: string;
  manifest?: Record<string, unknown> & { arguments: Record<string, unknown> };
};
type Content = {
  type: string;
  text?: string;
  uri?: string;
  resource?: { text?: string; blob?: string; mimeType?: string };
}[];

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function connect(env: NodeJS.ProcessEnv = {}, ctx = buildTestContext(undefined, env)) {
  const server = createServer(ctx);
  const client = new Client({ name: 'export-suite', version: '1.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function exportReport(client: Client, args: Record<string, unknown>) {
  const result = await client.callTool({ name: 'export_report', arguments: args });
  return {
    result,
    content: result.content as Content,
    structured: result.structuredContent as Structured,
  };
}

async function readText(client: Client, uri: string): Promise<string> {
  const { contents } = await client.readResource({ uri });
  return (contents[0] as { text: string }).text;
}

describe('export_report — HTML', () => {
  it('exports an Arabic country report as a self-contained RTL document', async () => {
    const client = await connect({ MALJA_PDF: 'off' });
    const { result, content, structured } = await exportReport(client, {
      country: 'Egypt',
      locale: 'ar',
    });
    expect(result.isError).toBeFalsy();
    expect(structured).toMatchObject({
      format: 'html',
      requested_format: 'html',
      mime_type: 'text/html',
      locale: 'ar',
      filename: expect.stringMatching(/^malja-report-egy-\d{8}-ar\.html$/),
    });
    expect(structured.uri).toMatch(/^export:\/\/[0-9a-f-]{36}\/malja-report-egy-\d{8}-ar\.html$/);
    expect(content[0]!.text).toMatch(/[\u0600-\u06FF]/);
    expect(content[1]).toMatchObject({ type: 'resource_link', uri: structured.uri });

    const html = await readText(client, structured.uri);
    expect(Buffer.byteLength(html)).toBe(structured.bytes);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('<title>مصر — تقرير عن الوضع الإنساني</title>');
    expect(html).toContain('src:url(data:font/woff2;base64,');
    // The chart is a static inline SVG, not a Mermaid block needing a renderer.
    expect(html).toContain('<figure class="chart"><svg');
    expect(html).not.toContain('language-mermaid');
    // Citation line and methodology note survive.
    expect(html).toContain('المصدر');
    expect(html).toContain('unhcr.org/refugee-statistics');
    // Extraction manifest, visible and machine-readable.
    expect(html).toContain('بيان الاستخراج');
    const json = /<script type="application\/json" id="malja-manifest">(.*?)<\/script>/.exec(html);
    expect(JSON.parse(json![1]!)).toMatchObject({
      tool: 'export_report',
      arguments: { country: 'Egypt', locale: 'ar', format: 'html' },
      source: 'mock',
    });
    expect(structured.manifest).toMatchObject({ tool: 'export_report', source: 'mock' });
  });

  it('exports English LTR and can omit the manifest', async () => {
    const client = await connect();
    const { structured } = await exportReport(client, {
      country: 'EGY',
      include_manifest: false,
      year_from: 2020,
      year_to: 2024,
    });
    expect(structured.filename).toMatch(/^malja-report-egy-\d{8}\.html$/);
    expect(structured.manifest).toBeUndefined();
    const html = await readText(client, structured.uri);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('Egypt — Humanitarian Situation Report');
    expect(html).not.toContain('malja-manifest');
  });

  it('wraps client-supplied Markdown safely, recording its hash', async () => {
    const client = await connect();
    const markdown = [
      '# Trend <script>alert(1)</script>',
      '',
      '| Year | Refugees |',
      '| --- | --- |',
      '| 2024 | 1,000 |',
      '',
      '```svg',
      '<svg onload="alert(1)"></svg>',
      '```',
    ].join('\n');
    const { structured } = await exportReport(client, { markdown, locale: 'ar' });
    expect(structured.title).toBe('Trend <script>alert(1)</script>');
    expect(structured.manifest).toMatchObject({
      source: expect.stringMatching(/[\u0600-\u06FF]|client/),
      content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const html = await readText(client, structured.uri);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<svg onload');
    expect(html).toContain('<td class="num">1,000</td>');
    expect(html).toContain('dir="rtl"');
  });

  it('export links survive across per-request servers sharing a context (HTTP mode)', async () => {
    const ctx = buildTestContext();
    const first = await connect({}, ctx);
    const { structured } = await exportReport(first, { country: 'Egypt' });
    const second = await connect({}, ctx);
    expect(await readText(second, structured.uri)).toContain('<!doctype html>');
  });

  it('an empty country does not make client markdown trusted', async () => {
    const client = await connect();
    const { structured } = await exportReport(client, {
      country: '  ',
      markdown: '# T\n\n```svg\n<svg onload="alert(1)"></svg>\n```',
    });
    const html = await readText(client, structured.uri);
    expect(html).not.toContain('<svg onload');
    expect(structured.manifest).toMatchObject({ content_sha256: expect.any(String) });
  });

  it('embeds the document when inline: true', async () => {
    const client = await connect();
    const { content, structured } = await exportReport(client, {
      country: 'Egypt',
      inline: true,
    });
    const embedded = content.find((c) => c.type === 'resource');
    expect(embedded?.resource?.mimeType).toBe('text/html');
    expect(embedded?.resource?.text).toContain('<!doctype html>');
    expect(structured.uri).toMatch(/^export:\/\//);
  });

  it('errors (localized) when neither country nor markdown is given', async () => {
    const client = await connect();
    const { result, content } = await exportReport(client, { locale: 'ar' });
    expect(result.isError).toBe(true);
    expect(content[0]!.text).toMatch(/[\u0600-\u06FF]/);
  });

  it('reports unknown or expired export ids', async () => {
    const client = await connect();
    await expect(
      client.readResource({ uri: 'export://00000000-0000-0000-0000-000000000000/x.html' }),
    ).rejects.toThrow();
  });
});

describe('export_report — PDF', () => {
  it('falls back to HTML when PDF is disabled', async () => {
    const client = await connect({ MALJA_PDF: 'off' });
    const { structured, content } = await exportReport(client, {
      country: 'Egypt',
      format: 'pdf',
    });
    expect(structured).toMatchObject({
      format: 'html',
      requested_format: 'pdf',
      fallback_reason: expect.stringContaining('MALJA_PDF'),
    });
    expect(content[0]!.text).toContain('print');
  });

  it('falls back to HTML when no browser is found', async () => {
    const client = await connect({ MALJA_CHROME_PATH: '/nonexistent/chrome' });
    const { structured } = await exportReport(client, {
      country: 'Egypt',
      format: 'pdf',
      locale: 'ar',
    });
    expect(structured.format).toBe('html');
    expect(structured.fallback_reason).toMatch(/[\u0600-\u06FF]/);
  });

  it.skipIf(!findBrowser())(
    'prints a real PDF with a local headless browser',
    async () => {
      const client = await connect();
      const { structured } = await exportReport(client, {
        country: 'Egypt',
        format: 'pdf',
        locale: 'ar',
      });
      expect(structured).toMatchObject({ format: 'pdf', mime_type: 'application/pdf' });
      expect(structured.pdf_engine).toBeTruthy();
      const { contents } = await client.readResource({ uri: structured.uri });
      const pdf = Buffer.from((contents[0] as { blob: string }).blob, 'base64');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBe(structured.bytes);
    },
    60_000,
  );
});
