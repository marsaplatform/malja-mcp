import { describe, expect, it } from 'vitest';
import { handleRequest, workerProcessEnv } from '../../src/worker.js';
import { buildTestContext } from '../helpers/context.js';

/**
 * Cloudflare Worker entry (src/worker.ts), exercised with plain Fetch API
 * Request objects — the same surface workerd hands to `fetch`.
 */

const ctx = buildTestContext();
const BASE = 'https://malja.example.org';

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
): Promise<Response> {
  return handleRequest(
    new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
    {},
    { context: ctx },
  );
}

describe('worker entry', () => {
  it('answers initialize with server info and CORS headers', async () => {
    const response = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('malja-mcp');
  });

  it('lists all 24 tools statelessly', async () => {
    const response = await rpc('tools/list');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools).toHaveLength(24);
  });

  it('calls a tool and returns Arabic output (locale ar)', async () => {
    const response = await rpc('tools/call', {
      name: 'search_country',
      arguments: { query: 'egypt', locale: 'ar' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(body.result.isError ?? false).toBe(false);
    expect(JSON.stringify(body.result)).toContain('EGY');
    expect(body.result.content[0]?.text).toContain('مصر');
  });

  it('describes itself on GET /mcp and reports health', async () => {
    const info = await handleRequest(new Request(`${BASE}/mcp`), {}, { context: ctx });
    expect(info.status).toBe(200);
    expect(((await info.json()) as { endpoint: string }).endpoint).toBe(`${BASE}/mcp`);

    const health = await handleRequest(new Request(`${BASE}/mcp/health`), {}, { context: ctx });
    const body = (await health.json()) as { ok: boolean; runtime: string };
    expect(body).toMatchObject({ ok: true, runtime: 'cloudflare-workers' });
  });

  it('rejects DELETE, handles CORS preflight, redirects / when a home URL is set, 404s elsewhere', async () => {
    const del = await handleRequest(
      new Request(`${BASE}/mcp`, { method: 'DELETE' }),
      {},
      { context: ctx },
    );
    expect(del.status).toBe(405);
    const pre = await handleRequest(
      new Request(`${BASE}/mcp`, { method: 'OPTIONS' }),
      {},
      { context: ctx },
    );
    expect(pre.status).toBe(204);
    const home = await handleRequest(
      new Request(`${BASE}/`),
      {},
      { context: ctx, homeUrl: 'https://example.org/malja' },
    );
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('https://example.org/malja');
    const missing = await handleRequest(new Request(`${BASE}/nope`), {}, { context: ctx });
    expect(missing.status).toBe(404);
  });

  it('maps Worker bindings to config: strings only, PDF off, memory cache', () => {
    const env = workerProcessEnv({
      MALJA_PROVIDERS: 'unhcr',
      MALJA_PDF: 'auto',
      MALJA_CACHE: 'sqlite',
      HMCP_LOCALE: 'ar',
      OTHER: 'ignored',
      KV: { binding: true },
    });
    expect(env).toMatchObject({
      MALJA_PROVIDERS: 'unhcr',
      MALJA_PDF: 'off',
      MALJA_CACHE: 'memory',
      HMCP_LOCALE: 'ar',
    });
    expect(env['OTHER']).toBeUndefined();
    expect(env['KV']).toBeUndefined();
  });
});
