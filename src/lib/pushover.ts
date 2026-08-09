/**
 * Pushover notifications to the ADMIN TEAM (owner request 2026-08-10): every
 * admin account with a `pushover_key` gets pinged on platform events (new
 * advertiser, pending verification). App token = Worker secret PUSHOVER_TOKEN;
 * per-admin user keys live on accounts.pushover_key (/admin/settings).
 *
 * Fire-and-forget like push.ts/email.ts — never adds latency to, or fails,
 * the action that caused it. LESSON BAKED IN: waitUntil wraps the WHOLE async
 * chain (DB read + fetch) — anything slow outside it gets dropped when the
 * invocation ends (the bug that silently killed early email sends).
 */

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
          const { requestDb } = await import('@/db/client');
          const { accounts } = await import('@/db/schema');
          const { and, isNotNull } = await import('drizzle-orm');
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
