import { describe, expect, it } from 'vitest';
import { InboundRateLimiter } from '../../src/http/rate-limit.js';

/** Deterministic clock the limiter reads instead of Date.now(). */
function clock(startAt = 0): { now: () => number; advance: (ms: number) => void } {
  let at = startAt;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe('InboundRateLimiter', () => {
  it('allows up to the per-minute budget and rejects the request after it', () => {
    const { now } = clock();
    const limiter = new InboundRateLimiter(3, now);

    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('tracks clients independently', () => {
    const { now } = clock();
    const limiter = new InboundRateLimiter(1, now);

    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
    expect(limiter.allow('5.6.7.8')).toBe(true);
  });

  it('resets the budget when the minute window rolls over', () => {
    const c = clock();
    const limiter = new InboundRateLimiter(1, c.now);

    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
    c.advance(60_001);
    expect(limiter.allow('1.2.3.4')).toBe(true);
  });

  it('is disabled entirely at 0 — every request passes', () => {
    const { now } = clock();
    const limiter = new InboundRateLimiter(0, now);
    for (let i = 0; i < 500; i++) {
      expect(limiter.allow('1.2.3.4')).toBe(true);
    }
  });

  it('reports how long a blocked client should wait, at least 1s', () => {
    const c = clock();
    const limiter = new InboundRateLimiter(1, c.now);

    limiter.allow('1.2.3.4');
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(60);
    c.advance(45_000);
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(15);
    c.advance(14_900);
    expect(limiter.retryAfterSeconds('1.2.3.4')).toBe(1);
    // Unknown clients have nothing to wait for.
    expect(limiter.retryAfterSeconds('9.9.9.9')).toBe(0);
  });

  it('evicts expired windows so the map cannot grow unboundedly', () => {
    const c = clock();
    const limiter = new InboundRateLimiter(10, c.now);

    for (let i = 0; i < 10_000; i++) limiter.allow(`ip-${i}`);
    expect(limiter.size).toBe(10_000);

    c.advance(60_001);
    limiter.allow('fresh-client'); // triggers pruning of the stale windows
    expect(limiter.size).toBeLessThan(10);
  });
});
