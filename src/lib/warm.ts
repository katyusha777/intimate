/**
 * Cache warming (docs/ARCHITECTURE §4). The worker CANNOT self-fetch its own
 * hostname to warm — Cloudflare loops that back to 522. So warming is driven
 * from OUTSIDE the worker (the admin's browser, or the GitHub Actions cron):
 * this module just builds the list of live-profile URLs; the caller fetches
 * them (an external GET → worker → render → KV store). Idempotent — an already
 * -warm URL just serves HIT.
 * ponytail: cap 600 urls per sweep; chunk by offset if the live count outgrows
 * one pass.
 */
import { eq } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { profiles } from '@/db/schema';
import { LOCALES } from '@/lib/taxonomy';

export async function listWarmUrls(opts: {
  origin: string;
  hyperdrive: Pick<Hyperdrive, 'connectionString'>;
  locales?: readonly string[];
  cap?: number;
}): Promise<string[]> {
  const locales = opts.locales ?? LOCALES;
  const db = requestDb(opts.hyperdrive);
  const rows = await db.select({ slug: profiles.slug }).from(profiles).where(eq(profiles.state, 'live'));
  // Homepages first — short TTL (HOME_TTL_S), so they depend on the cron re-warm.
  const homes = locales.map((l) => `${opts.origin}/${l}`);
  const urls = rows.flatMap((r) => locales.map((l) => `${opts.origin}/${l}/profile/${r.slug}/`));
  return [...homes, ...urls].slice(0, opts.cap ?? 600);
}
