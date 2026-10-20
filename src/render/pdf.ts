import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * HTML → PDF through an already-installed headless Chromium-family browser
 * (Chrome, Chromium, Edge). Chosen over pure-JS PDF libraries because those
 * do not implement Arabic shaping + bidi correctly without heavy font/bidi
 * stacks; the browser renders exactly the print-ready HTML (Zad font, RTL,
 * inline SVG charts). No new npm dependency; nothing is downloaded. When no
 * browser is found, callers fall back to the HTML file (print → PDF).
 */

const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/** The browser to use: explicit path (if it exists), else the first known install. */
export function findBrowser(
  explicit?: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (explicit && explicit.trim() !== '') return exists(explicit) ? explicit : undefined;
  return CANDIDATES.find((path) => exists(path));
}

let queue: Promise<unknown> = Promise.resolve();

/** Run one browser at a time — PDF rendering is heavy; never fan out. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export interface PdfOptions {
  timeoutMs?: number;
}

/** Render a self-contained HTML document to PDF bytes. */
export function htmlToPdf(
  html: string,
  browser: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  return serialized(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'malja-pdf-'));
    try {
      const htmlPath = join(dir, 'report.html');
      const pdfPath = join(dir, 'report.pdf');
      await writeFile(htmlPath, html, 'utf8');
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--no-pdf-header-footer',
        `--user-data-dir=${join(dir, 'profile')}`,
        `--print-to-pdf=${pdfPath}`,
        '--virtual-time-budget=10000',
        // Chrome refuses to start as root without this (typical in containers).
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        pathToFileURL(htmlPath).href,
      ];
      await new Promise<void>((resolve, reject) => {
        execFile(
          browser,
          args,
          { timeout: options.timeoutMs ?? 60_000, windowsHide: true },
          (error, _stdout, stderr) => {
            if (error)
              reject(new Error(`${error.message}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`));
            else resolve();
          },
        );
      });
      const pdf = await readFile(pdfPath);
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error('browser did not produce a PDF');
      }
      return pdf;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
