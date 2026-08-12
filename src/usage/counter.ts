/**
 * Usage measurement for a public, free service.
 *
 * Two layers, both privacy-first:
 *
 * 1. Anonymous aggregate (always on) — per-day, per-tool request counts split
 *    keyed vs anonymous, plus a same-day unique-client estimate. Uniqueness
 *    uses a hash salted with a per-day random value held only in memory, so
 *    the stored hashes cannot be linked across days or back to an IP. Raw IPs
 *    are never written. This powers the public transparency page.
 *
 * 2. Keyed attribution (optional) — a free key attributes calls to a subject
 *    and lifts the anonymous rate limit up to a monthly ceiling. Keyed usage is
 *    counted per subject/month and, when a SaaSpress control plane is
 *    configured, reported to it in idempotent batches for the storefront's
 *    own analytics. Nothing here charges anyone.
 *
 * Storage is node:sqlite (durable); if unavailable it degrades to in-memory so
 * the server still runs — counting just resets on restart.
 */

import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ingestUsage,
  resolveEntitlement,
  saaspressConfig,
  type EntitlementResult,
  type SaaSpressConfig,
} from './saaspress-client.js';

interface Stmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
}

export interface CounterOptions {
  databasePath?: string;
  metric?: string;
  monthlyFreeLimit?: number;
  saaspress?: SaaSpressConfig | null;
  keySecret?: string;
}

const FLUSH_INTERVAL_MS = 60_000;
const ENTITLEMENT_TTL_MS = 60_000;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

async function openDb(path: string): Promise<Db | null> {
  try {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      /* dir may already exist */
    }
    const sqlite = (await import('node:sqlite')) as { DatabaseSync: new (p: string) => Db };
    return new sqlite.DatabaseSync(path);
  } catch {
    return null; // node:sqlite unavailable — caller falls back to memory
  }
}

export class UsageCounter {
  private db: Db | null = null;
  private readonly mem = {
    daily: new Map<string, number>(), // `${day}|${tool}|${keyed}` -> count
    subject: new Map<string, number>(), // `${subject}|${month}` -> count
    uniques: new Set<string>(), // `${day}|${hash}`
  };
  private dailySalt = { day: today(), salt: randomBytes(16).toString('hex') };
  private readonly entitlementCache = new Map<string, { result: EntitlementResult; at: number }>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private batchSeq = 0;
  private readonly pendingBatches: { id: number; subject: string; qty: number }[] = [];

  constructor(private readonly opts: CounterOptions = {}) {}

  static async create(opts: CounterOptions = {}): Promise<UsageCounter> {
    const counter = new UsageCounter(opts);
    if (opts.databasePath) {
      counter.db = await openDb(opts.databasePath);
      if (counter.db) counter.migrate();
    }
    if (opts.saaspress && opts.keySecret) counter.startFlusher();
    return counter;
  }

  private migrate(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        day TEXT NOT NULL, tool TEXT NOT NULL, keyed INTEGER NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (day, tool, keyed));
      CREATE TABLE IF NOT EXISTS usage_subject (
        subject TEXT NOT NULL, month TEXT NOT NULL, count INTEGER NOT NULL, batched INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (subject, month));
      CREATE TABLE IF NOT EXISTS usage_uniques (
        day TEXT NOT NULL, client_hash TEXT NOT NULL, PRIMARY KEY (day, client_hash));
    `);
  }

  /** Per-day rotating salt: same-day uniqueness only, no cross-day linkage. */
  private hashClient(client: string): string {
    const day = today();
    if (this.dailySalt.day !== day) this.dailySalt = { day, salt: randomBytes(16).toString('hex') };
    return createHash('sha256').update(this.dailySalt.salt).update(client).digest('hex').slice(0, 24);
  }

  /**
   * Record one served request.
   * @param tool  JSON-RPC method or tool name ("tools/call:country_profile", "resources/read", ...)
   * @param subject billing subject when keyed, else null
   * @param client opaque client id (IP or subject) for the unique estimate
   */
  record(tool: string, subject: string | null, client: string): void {
    const day = today();
    const keyed = subject ? 1 : 0;
    const t = tool.slice(0, 80);
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO usage_daily (day, tool, keyed, count) VALUES (?1, ?2, ?3, 1)
           ON CONFLICT(day, tool, keyed) DO UPDATE SET count = count + 1`,
        )
        .run(day, t, keyed);
      this.db
        .prepare('INSERT OR IGNORE INTO usage_uniques (day, client_hash) VALUES (?1, ?2)')
        .run(day, this.hashClient(client));
      if (subject) {
        this.db
          .prepare(
            `INSERT INTO usage_subject (subject, month, count) VALUES (?1, ?2, 1)
             ON CONFLICT(subject, month) DO UPDATE SET count = count + 1`,
          )
          .run(subject, monthKey());
      }
    } else {
      const dk = `${day}|${t}|${keyed}`;
      this.mem.daily.set(dk, (this.mem.daily.get(dk) ?? 0) + 1);
      this.mem.uniques.add(`${day}|${this.hashClient(client)}`);
      if (subject) {
        const sk = `${subject}|${monthKey()}`;
        this.mem.subject.set(sk, (this.mem.subject.get(sk) ?? 0) + 1);
      }
    }
  }

  usedThisMonth(subject: string): number {
    if (this.db) {
      const row = this.db
        .prepare('SELECT count FROM usage_subject WHERE subject = ?1 AND month = ?2')
        .get(subject, monthKey());
      return row ? Number(row.count) : 0;
    }
    return this.mem.subject.get(`${subject}|${monthKey()}`) ?? 0;
  }

  /**
   * Gate a call. Anonymous is always allowed (the caller applies the IP rate
   * limit). A key that is present must be valid; a valid key over its generous
   * monthly ceiling is throttled back to anonymous rather than blocked.
   */
  async gate(apiKey: string | null): Promise<
    { keyed: false } | { keyed: true; subject: string; overLimit: boolean }
  > {
    if (!apiKey || !this.opts.keySecret) return { keyed: false };
    const { verifyFreeKey } = await import('./keys.js');
    const subject = await verifyFreeKey(apiKey, this.opts.keySecret);
    if (!subject) return { keyed: false };
    const limit = this.opts.monthlyFreeLimit ?? 50_000;
    const used = this.usedThisMonth(subject);
    // If a control plane is configured, honor its entitlement too (lets an
    // enterprise tier lift the ceiling later); otherwise the fixed free cap.
    let effectiveLimit = limit;
    if (this.opts.saaspress) {
      const ent = await this.entitlementFor(subject);
      if (ent.found) {
        const planLimit = Number(ent.entitlement.limits?.[this.opts.metric ?? 'hm_calls'] ?? 0);
        if (planLimit > 0) effectiveLimit = planLimit;
      }
    }
    return { keyed: true, subject, overLimit: used >= effectiveLimit };
  }

  private async entitlementFor(subject: string): Promise<EntitlementResult> {
    const cached = this.entitlementCache.get(subject);
    if (cached && Date.now() - cached.at < ENTITLEMENT_TTL_MS) return cached.result;
    try {
      const result = await resolveEntitlement(this.opts.saaspress!, {
        subjectType: 'user',
        subjectExternalId: subject,
      });
      this.entitlementCache.set(subject, { result, at: Date.now() });
      return result;
    } catch {
      return { found: false };
    }
  }

  /** Public transparency summary — no per-subject or per-client detail. */
  summary(): {
    total: number;
    keyed: number;
    anonymous: number;
    uniqueToday: number;
    topTools: { tool: string; count: number }[];
    days: { day: string; count: number }[];
  } {
    if (!this.db) {
      let total = 0,
        keyed = 0;
      const tools = new Map<string, number>();
      for (const [k, v] of this.mem.daily) {
        const [, tool, keyedFlag] = k.split('|');
        total += v;
        if (keyedFlag === '1') keyed += v;
        tools.set(tool, (tools.get(tool) ?? 0) + v);
      }
      const uniqueToday = [...this.mem.uniques].filter((u) => u.startsWith(`${today()}|`)).length;
      return {
        total,
        keyed,
        anonymous: total - keyed,
        uniqueToday,
        topTools: [...tools.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([tool, count]) => ({ tool, count })),
        days: [],
      };
    }
    const totals = this.db.prepare('SELECT keyed, SUM(count) c FROM usage_daily GROUP BY keyed').all();
    let keyed = 0,
      anonymous = 0;
    for (const row of totals) {
      if (Number(row.keyed) === 1) keyed = Number(row.c);
      else anonymous = Number(row.c);
    }
    const topTools = this.db
      .prepare('SELECT tool, SUM(count) c FROM usage_daily GROUP BY tool ORDER BY c DESC LIMIT 10')
      .all()
      .map((r) => ({ tool: String(r.tool), count: Number(r.c) }));
    const days = this.db
      .prepare(
        `SELECT day, SUM(count) c FROM usage_daily WHERE day >= date('now', '-29 days')
         GROUP BY day ORDER BY day`,
      )
      .all()
      .map((r) => ({ day: String(r.day), count: Number(r.c) }));
    const uniqueToday = Number(
      this.db.prepare('SELECT COUNT(*) c FROM usage_uniques WHERE day = ?1').get(today())?.c ?? 0,
    );
    return { total: keyed + anonymous, keyed, anonymous, uniqueToday, topTools, days };
  }

  /** Report keyed monthly deltas to SaaSpress in idempotent batches. */
  async flush(): Promise<{ sent: number; failed: number }> {
    if (!this.opts.saaspress || !this.db) return { sent: 0, failed: 0 };
    const rows = this.db
      .prepare('SELECT subject, month, count, batched FROM usage_subject WHERE count > batched')
      .all();
    for (const row of rows) {
      const qty = Number(row.count) - Number(row.batched);
      this.batchSeq += 1;
      this.pendingBatches.push({ id: this.batchSeq, subject: String(row.subject), qty });
      this.db
        .prepare('UPDATE usage_subject SET batched = ?1 WHERE subject = ?2 AND month = ?3')
        .run(Number(row.count), row.subject, row.month);
    }
    let sent = 0,
      failed = 0;
    for (const batch of [...this.pendingBatches]) {
      try {
        await ingestUsage(this.opts.saaspress, {
          id: `evt_hm_batch_${batch.id}`,
          appId: this.opts.saaspress.appId,
          subjectId: batch.subject,
          metric: this.opts.metric ?? 'hm_calls',
          quantity: batch.qty,
          idempotencyKey: `hm:batch:${batch.id}`,
          occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        });
        this.pendingBatches.splice(this.pendingBatches.indexOf(batch), 1);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    return { sent, failed };
  }

  private startFlusher(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }
}

export function usageOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): CounterOptions {
  return {
    databasePath: env.HMCP_USAGE_DATABASE_PATH || undefined,
    metric: env.HMCP_USAGE_METRIC || 'hm_calls',
    monthlyFreeLimit: Number(env.HMCP_FREE_MONTHLY_LIMIT || '50000'),
    keySecret: env.HMCP_KEY_SECRET || undefined,
    saaspress: saaspressConfig(env),
  };
}
