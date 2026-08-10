/**
 * Fixed-window KV rate limiter (items.md #12 — SMS cost protection; reusable
 * for any abuse-prone action). Race-tolerant, not exact: two concurrent
 * requests may both pass at the boundary — fine for "hostile to spam,
 * generous to humans" (MESSAGING.md §11).
 */
import type { CacheKv } from '@/lib/page-cache';

/** True = allowed (and the attempt is counted); false = over the limit.
 *  `failClosedInProd`: when the KV binding is missing, the default is to fail
 *  OPEN (local dev never locks humans out). Money/brute-force walls (auth, SMS)
 *  pass `true` so that in PRODUCTION a missing/hiccuping KV DENIES instead of
 *  silently disabling the wall — a brief 429 beats an open toll-fraud tap. */
export async function rateLimit(
  kv: CacheKv | undefined,
  name: string,
  key: string,
  max: number,
  windowS = 3600,
  failClosedInProd = false,
): Promise<boolean> {
  if (!kv) return !(failClosedInProd && import.meta.env.PROD); // no KV → open in dev, closed for guarded walls in prod
  const k = `rl:${name}:${key}`;
  const count = Number((await kv.get(k)) ?? '0');
  if (count >= max) return false;
  await kv.put(k, String(count + 1), { expirationTtl: windowS });
  return true;
}
