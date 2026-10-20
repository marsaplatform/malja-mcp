import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies sensible defaults with an empty environment', () => {
    const config = loadConfig({});
    expect(config.providers).toEqual(['unhcr', 'worldbank']);
    expect(config.cacheBackend).toBe('memory');
    expect(config.cacheTtlSeconds).toBe(3600);
    expect(config.offline).toBe(false);
    expect(config.rateLimitRps).toBe(4);
    expect(config.logLevel).toBe('info');
    expect(config.analytics).toBe(true);
    expect(config.userAgent).toContain('malja-mcp/');
  });

  it('parses provider lists, booleans and integers', () => {
    const config = loadConfig({
      MALJA_PROVIDERS: 'unhcr, reliefweb ',
      MALJA_OFFLINE: '1',
      MALJA_ANALYTICS: 'false',
      MALJA_CACHE_TTL: '60',
      MALJA_CACHE: 'sqlite',
    });
    expect(config.providers).toEqual(['unhcr', 'reliefweb']);
    expect(config.offline).toBe(true);
    expect(config.analytics).toBe(false);
    expect(config.cacheTtlSeconds).toBe(60);
    expect(config.cacheBackend).toBe('sqlite');
  });

  it('rejects invalid values with clear messages', () => {
    expect(() => loadConfig({ MALJA_CACHE: 'redis' })).toThrow(/MALJA_CACHE/);
    expect(() => loadConfig({ MALJA_LOG_LEVEL: 'loud' })).toThrow(/MALJA_LOG_LEVEL/);
    expect(() => loadConfig({ MALJA_CACHE_TTL: '-5' })).toThrow(/MALJA_CACHE_TTL/);
    expect(() => loadConfig({ MALJA_PROVIDERS: ' , ' })).toThrow(/at least one provider/);
  });

  it('parses PDF export settings', () => {
    expect(loadConfig({}).pdf).toBe('auto');
    expect(loadConfig({}).chromePath).toBe('');
    expect(loadConfig({ MALJA_PDF: 'off' }).pdf).toBe('off');
    expect(loadConfig({ MALJA_PDF: 'false' }).pdf).toBe('off');
    expect(loadConfig({ MALJA_CHROME_PATH: '/usr/bin/chromium' }).chromePath).toBe(
      '/usr/bin/chromium',
    );
    expect(() => loadConfig({ MALJA_PDF: 'maybe' })).toThrow(/MALJA_PDF/);
  });

  it('clamps the rate limit to at least 1 rps', () => {
    expect(loadConfig({ MALJA_RATE_LIMIT_RPS: '0' }).rateLimitRps).toBe(1);
  });

  it('honours legacy HMCP_* variables as a deprecated fallback', () => {
    const legacy = loadConfig({ HMCP_PROVIDERS: 'unhcr', HMCP_CACHE_TTL: '42' });
    expect(legacy.providers).toEqual(['unhcr']);
    expect(legacy.cacheTtlSeconds).toBe(42);
    const both = loadConfig({ HMCP_CACHE_TTL: '42', MALJA_CACHE_TTL: '7' });
    expect(both.cacheTtlSeconds).toBe(7);
  });
});
