/**
 * Pushover notifications to the ADMIN TEAM (owner request 2026-08-10): every
 * admin account with a `pushover_key` gets pinged on platform events (new
 * advertiser, pending verification). App token = Worker secret PUSHOVER_TOKEN;
 * per-admin user keys live on accounts.pushover_key (/admin/settings).
 *
 * Fire-and-forget like push.ts/email.ts — never adds latency to, or fails,
 * the action that caused it. TWO lessons baked in:
 * - waitUntil wraps the WHOLE async chain (DB read + fetch) — anything slow
 *   outside it gets dropped when the invocation ends (the early-email bug).
 * - db/client + schema + drizzle are STATIC imports: dynamically importing a
 *   module the rest of the graph imports statically gave the bundle a second,
 *   racing evaluation order — cold isolates 500'd the whole site with "Class
 *   extends value undefined" (2026-08-10). Only cloudflare:workers stays
 *   dynamic (bun tests can't load it).
 */
import { and, isNotNull } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { accounts } from '@/db/schema';

export function pushoverAdmins(title: string, message: string): void {
  void (async () => {
    try {
      const { env, waitUntil } = await import('cloudflare:workers');
      const e = env as unknown as Record<string, unknown>;
      const token = e.PUSHOVER_TOKEN as string | undefined;
      if (!token) {
        console.warn('[pushover] PUSHOVER_TOKEN unset — skipping', title);
        return;
      }
      waitUntil(
        (async () => {
          const d = requestDb(e.HYPERDRIVE as Hyperdrive);
          const rows = await d
            .select({ key: accounts.pushoverKey })
            .from(accounts)
            .where(and(isNotNull(accounts.adminRole), isNotNull(accounts.pushoverKey)));
          const keys = rows.map((r) => r.key).filter(Boolean) as string[];
          if (!keys.length) {
            console.log('[pushover] no admin keys configured — skipping', title);
            return;
          }
          // One request: Pushover accepts comma-separated user keys (≤50).
          const res = await fetch('https://api.pushover.net/1/messages.json', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, user: keys.join(','), title, message }),
          });
          if (!res.ok) {
            console.error('[pushover] send FAILED:', res.status, (await res.text()).slice(0, 200));
          } else {
            console.log('[pushover] sent:', title, '->', keys.length, 'admin(s)');
          }
        })().catch((err) => console.error('[pushover] send FAILED:', (err as Error).message)),
      );
    } catch (err) {
      console.error('[pushover] hook failed:', (err as Error)?.message ?? err);
    }
  })();
}
