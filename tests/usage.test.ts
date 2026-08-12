import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { deriveFreeKey, verifyFreeKey } from '../src/usage/keys.js';
import { UsageCounter } from '../src/usage/counter.js';

const SECRET = 'hm-test-secret';
const DB = 'test-usage.sqlite';

afterEach(() => rmSync(DB, { force: true }));

describe('free keys', () => {
  it('derive/verify maps to the billing subject', async () => {
    const key = await deriveFreeKey(7, SECRET);
    expect(key).toMatch(/^hm_7_[0-9a-f]{16}$/);
    expect(await verifyFreeKey(key, SECRET)).toBe('wp:customer-7');
  });

  it('rejects tampering and wrong secret', async () => {
    const key = await deriveFreeKey(7, SECRET);
    expect(await verifyFreeKey(key.replace('_7_', '_8_'), SECRET)).toBeNull();
    expect(await verifyFreeKey(key, 'other')).toBeNull();
    expect(await verifyFreeKey('nope', SECRET)).toBeNull();
  });
});

describe('usage counter (memory backend)', () => {
  it('counts anonymous and keyed, splits totals, tracks tools', async () => {
    const c = await UsageCounter.create({ keySecret: SECRET });
    c.record('tool:country_profile', null, '1.1.1.1');
    c.record('tool:country_profile', 'wp:customer-7', '1.1.1.1');
    c.record('tool:refugee_statistics', 'wp:customer-7', '1.1.1.1');
    const s = c.summary();
    expect(s.total).toBe(3);
    expect(s.keyed).toBe(2);
    expect(s.anonymous).toBe(1);
    expect(s.uniqueToday).toBe(1);
    expect(s.topTools[0]).toEqual({ tool: 'tool:country_profile', count: 2 });
    expect(c.usedThisMonth('wp:customer-7')).toBe(2);
    c.stop();
  });

  it('gate: no key = anonymous, valid key = keyed, over-limit throttles', async () => {
    const c = await UsageCounter.create({ keySecret: SECRET, monthlyFreeLimit: 2 });
    expect((await c.gate(null)).keyed).toBe(false);
    expect((await c.gate('garbage')).keyed).toBe(false);
    const key = await deriveFreeKey(7, SECRET);
    const g1 = await c.gate(key);
    expect(g1).toEqual({ keyed: true, subject: 'wp:customer-7', overLimit: false });
    c.record('tool:x', 'wp:customer-7', 'ip');
    c.record('tool:x', 'wp:customer-7', 'ip');
    const g2 = await c.gate(key);
    expect(g2).toEqual({ keyed: true, subject: 'wp:customer-7', overLimit: true });
    c.stop();
  });
});

describe('usage counter (sqlite backend)', () => {
  it('persists counts across instances', async () => {
    const first = await UsageCounter.create({ databasePath: DB, keySecret: SECRET });
    first.record('tool:country_profile', 'wp:customer-7', 'ip');
    first.stop();
    const second = await UsageCounter.create({ databasePath: DB, keySecret: SECRET });
    expect(second.usedThisMonth('wp:customer-7')).toBe(1);
    expect(second.summary().total).toBe(1);
    second.stop();
  });

  it('flush reports keyed deltas idempotently and retries failures', async () => {
    const { createServer } = await import('node:http');
    const seen: { key: string; qty: number }[] = [];
    let failFirst = true;
    const stub = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const evt = JSON.parse(body) as { idempotencyKey: string; quantity: number };
        if (failFirst) {
          failFirst = false;
          res.writeHead(503).end('boom');
          return;
        }
        seen.push({ key: evt.idempotencyKey, qty: evt.quantity });
        res.writeHead(202, { 'content-type': 'application/json' }).end('{"outcome":"accepted"}');
      });
    });
    await new Promise<void>((r) => stub.listen(0, r));
    const port = (stub.address() as { port: number }).port;
    const c = await UsageCounter.create({
      databasePath: DB,
      keySecret: SECRET,
      saaspress: { baseUrl: `http://127.0.0.1:${port}`, appId: 'app_hm', keyId: 'k', secret: 's' },
    });
    c.record('tool:x', 'wp:customer-7', 'ip');
    c.record('tool:x', 'wp:customer-7', 'ip');
    expect((await c.flush()).failed).toBe(1);
    expect(seen.length).toBe(0);
    expect((await c.flush()).sent).toBe(1);
    expect(seen).toEqual([{ key: 'hm:batch:1', qty: 2 }]);
    c.stop();
    await new Promise<void>((r) => stub.close(() => r()));
  });
});
