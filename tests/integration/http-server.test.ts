import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../src/http/server.js';
import { buildTestContext } from '../helpers/context.js';
import { MockProvider } from '../helpers/mock-provider.js';

/**
 * The public --http surface: liveness endpoint, per-client inbound rate
 * limiting and the memoized status payload. Tests share one server with a
 * deliberately tiny budget (5 requests/minute) and run in order:
 * /health is exempt, /api/status consumes 2, the flood test uses the rest.
 */

describe('http mode', () => {
  const provider = new MockProvider();
  const healthSpy = vi.spyOn(provider, 'health');
  const ctx = buildTestContext(provider, { HMCP_HTTP_RATE_LIMIT_RPM: '5' });
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = await startHttpServer(ctx, 0);
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('server has no address');
    }
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  it('GET /health answers instantly, without touching any provider, and is never rate limited', async () => {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; name: string; version: string };
      expect(body.status).toBe('ok');
      expect(body.name).toBe('humanitarian-mcp');
      expect(body.version.length).toBeGreaterThan(0);
    }
    expect(healthSpy).not.toHaveBeenCalled();
  });

  it('memoizes /api/status so refreshes cannot fan out to upstream health probes', async () => {
    const first = await fetch(`${base}/api/status`);
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/api/status`);
    expect(second.status).toBe(200);

    expect(healthSpy).toHaveBeenCalledTimes(1);
    const body = (await second.json()) as { config: { httpRateLimitRpm: number } };
    expect(body.config.httpRateLimitRpm).toBe(5);
  });

  it('answers 429 with Retry-After once a client exhausts its budget', async () => {
    // Budget is 5/min; the status test consumed 2 → three more pass, then 429.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await fetch(`${base}/api/logs`);
      statuses.push(response.status);
      if (response.status === 429) {
        expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        const body = (await response.json()) as { error: string };
        expect(body.error).toMatch(/rate limited/i);
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('rate-limits /mcp with a JSON-RPC-shaped error', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
    });
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      jsonrpc: string;
      error: { code: number; message: string };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toMatch(/rate limited/i);
  });
});
