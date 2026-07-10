/**
 * Fixed-window inbound rate limiter, one budget per client key (IP).
 *
 * Unlike `shared/rate-limiter.ts` — which paces our *outgoing* provider
 * calls by waiting — this one is non-blocking: callers get an allow/deny
 * verdict and answer 429 themselves. It protects the public `--http` mode
 * from a single client exhausting the shared upstream quotas and cache.
 */

const WINDOW_MS = 60_000;
/** Above this many tracked clients, expired windows are swept on insert. */
const PRUNE_THRESHOLD = 10_000;

interface Window {
  readonly start: number;
  readonly count: number;
}

export class InboundRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly maxPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  /** True when this request fits the client's per-minute budget. */
  allow(key: string): boolean {
    if (this.maxPerMinute <= 0) return true; // disabled
    const now = this.now();
    const window = this.windows.get(key);

    if (!window || now - window.start >= WINDOW_MS) {
      if (this.windows.size >= PRUNE_THRESHOLD) this.prune(now);
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }

    const next: Window = { start: window.start, count: window.count + 1 };
    this.windows.set(key, next);
    return next.count <= this.maxPerMinute;
  }

  /** Seconds until the client's window resets — for the Retry-After header. */
  retryAfterSeconds(key: string): number {
    const window = this.windows.get(key);
    if (!window) return 0;
    const remaining = window.start + WINDOW_MS - this.now();
    return remaining <= 0 ? 0 : Math.max(1, Math.ceil(remaining / 1000));
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= WINDOW_MS) this.windows.delete(key);
    }
  }
}
