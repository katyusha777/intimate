/**
 * Fixed-window KV rate limiter (items.md #12 — SMS cost protection; reusable
 * for any abuse-prone action). Race-tolerant, not exact: two concurrent
 * requests may both pass at the boundary — fine for "hostile to spam,
 * generous to humans" (MESSAGING.md §11).
 */
import type { CacheKv } from '@/lib/page-cache';

/** True = allowed (and the attempt is counted); false = over the limit. */
export async function rateLimit(
  kv: CacheKv | undefined,
  name: string,
  key: string,
  max: number,
  windowS = 3600,
): Promise<boolean> {
  if (!kv) return true; // no KV (local dev) → open
  const k = `rl:${name}:${key}`;
  const count = Number((await kv.get(k)) ?? '0');
  if (count >= max) return false;
  await kv.put(k, String(count + 1), { expirationTtl: windowS });
  return true;
}
