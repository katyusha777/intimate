/**
 * SMS abuse guard (items.md #12): the fixed-window KV limiter must allow up to
 * `max` attempts per window, then block — and fail OPEN when no KV is bound
 * (local dev), never locking humans out.
 */
import { describe, expect, test } from 'bun:test';
import { rateLimit } from '../src/lib/rate-limit';
import type { CacheKv } from '../src/lib/page-cache';

/** In-memory stand-in for the KV binding (ignores TTL — irrelevant to counting). */
function fakeKv(): CacheKv {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
  };
}

describe('rateLimit', () => {
  test('allows exactly `max` attempts, then blocks', async () => {
    const kv = fakeKv();
    const attempt = () => rateLimit(kv, 'sms', '+31600000000', 3);
    expect(await attempt()).toBe(true); // 1
    expect(await attempt()).toBe(true); // 2
    expect(await attempt()).toBe(true); // 3
    expect(await attempt()).toBe(false); // 4 — over the limit
  });

  test('counts per key — one number over the limit does not block another', async () => {
    const kv = fakeKv();
    await rateLimit(kv, 'sms', 'a', 1);
    expect(await rateLimit(kv, 'sms', 'a', 1)).toBe(false); // a is spent
    expect(await rateLimit(kv, 'sms', 'b', 1)).toBe(true); // b is fresh
  });

  test('no KV binding → fails open (dev never locks out)', async () => {
    expect(await rateLimit(undefined, 'sms', 'x', 1)).toBe(true);
    expect(await rateLimit(undefined, 'sms', 'x', 1)).toBe(true);
  });
});
