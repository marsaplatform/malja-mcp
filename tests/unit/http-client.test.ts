import { describe, expect, it, vi } from 'vitest';
import { InstrumentedCache, MemoryCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { ProviderError } from '../../src/errors.js';
import { Logger } from '../../src/logger.js';
import { HttpClient } from '../../src/shared/http.js';
import { RateLimiter } from '../../src/shared/rate-limiter.js';

const URL_ = 'https://api.example.test/data';

function build(opts: { offline?: boolean; fetchImpl: typeof fetch; ttl?: number }) {
  const cache = new InstrumentedCache(new MemoryCache());
  const config = loadConfig({
    MALJA_OFFLINE: opts.offline ? '1' : '0',
    MALJA_CACHE_TTL: String(opts.ttl ?? 3600),
    MALJA_RATE_LIMIT_RPS: '1000',
    MALJA_LOG_LEVEL: 'error',
  });
  const client = new HttpClient({
    cache,
    config,
    logger: new Logger('error', () => {}),
    limiter: new RateLimiter(1000),
    provider: 'test',
    fetchImpl: opts.fetchImpl,
  });
  return { cache, client };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('HttpClient', () => {
  it('fetches, caches and serves fresh entries without re-fetching', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: 1 }, { headers: { etag: 'W/"v1"' } }));
    const { client, cache } = build({ fetchImpl });

    expect(await client.getJson(URL_)).toEqual({ ok: 1 });
    expect(await client.getJson(URL_)).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const entry = await cache.get(URL_);
    expect(entry?.etag).toBe('W/"v1"');
  });

  it('sends If-None-Match and treats 304 as a revalidation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ v: 1 }, { headers: { etag: 'W/"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const { client, cache } = build({ fetchImpl, ttl: 0 }); // ttl 0 → always revalidate

    await client.getJson(URL_);
    // Age > staleMs is required to force a foreground revalidation; simulate by
    // rewinding the stored timestamp beyond the stale window.
    const entry = (await cache.get(URL_))!;
    await cache.set(URL_, { ...entry, fetchedAt: 0 });

    expect(await client.getJson(URL_)).toEqual({ v: 1 });
    const headers = (fetchImpl.mock.calls[1]![1] as { headers: Record<string, string> }).headers;
    expect(headers['if-none-match']).toBe('W/"v1"');
    expect(cache.stats.revalidations).toBe(1);
  });

  it('retries retryable statuses with backoff and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { client } = build({ fetchImpl });

    expect(await client.getJson(URL_)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('does not retry non-retryable statuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    const { client } = build({ fetchImpl });

    await expect(client.getJson(URL_)).rejects.toThrow(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves stale cache when the network dies', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ cached: true }))
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const { client, cache } = build({ fetchImpl });

    await client.getJson(URL_);
    const entry = (await cache.get(URL_))!;
    await cache.set(URL_, { ...entry, fetchedAt: 0 }); // ancient → forces refetch

    expect(await client.getJson(URL_)).toEqual({ cached: true });
    expect(cache.stats.staleServed).toBeGreaterThan(0);
  }, 15_000);

  it('offline mode serves cache and fails clearly on a miss', async () => {
    const online = vi.fn().mockResolvedValue(jsonResponse({ warm: 1 }));
    const warmed = build({ fetchImpl: online });
    await warmed.client.getJson(URL_);

    const neverCalled = vi.fn();
    const offlineClient = new HttpClient({
      cache: warmed.cache,
      config: loadConfig({ MALJA_OFFLINE: '1', MALJA_LOG_LEVEL: 'error' }),
      logger: new Logger('error', () => {}),
      limiter: new RateLimiter(1000),
      provider: 'test',
      fetchImpl: neverCalled as unknown as typeof fetch,
    });

    expect(await offlineClient.getJson(URL_)).toEqual({ warm: 1 });
    await expect(offlineClient.getJson('https://api.example.test/other')).rejects.toMatchObject({
      kind: 'offline_miss',
    });
    expect(neverCalled).not.toHaveBeenCalled();
  });
});
