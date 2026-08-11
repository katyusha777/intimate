/**
 * Pushover notifications to the ADMIN TEAM (owner request 2026-08-10): every
 * admin account with a `pushover_key` gets pinged on platform events. App
 * token = Worker secret PUSHOVER_TOKEN; per-admin user keys live on
 * accounts.pushover_key; per-EVENT on/off toggles live in KV (`notify:prefs`,
 * managed at /admin/settings — losing KV just restores the all-on defaults,
 * which is why a table isn't warranted).
 *
 * Admin notifications are PUSHOVER-ONLY (admin emails for these were turned
 * off 2026-08-10; email stays for user-facing mail — lib/email.ts).
 *
 * Fire-and-forget like push.ts/email.ts — never adds latency to, or fails,
 * the action that caused it. TWO lessons baked in:
 * - waitUntil wraps the WHOLE async chain (KV/DB reads + fetch) — anything
 *   slow outside it gets dropped when the invocation ends (the early-email bug).
 * - db/client + schema + drizzle are STATIC imports: dynamically importing a
 *   module the rest of the graph imports statically gave the bundle a second,
 *   racing evaluation order — cold isolates 500'd the whole site (2026-08-10).
 *   Only cloudflare:workers stays dynamic (bun tests can't load it).
 */
import { and, isNotNull } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { accounts } from '@/db/schema';

export type AdminEvent =
  | 'advertiser_registered'
  | 'verification_pending'
  | 'client_registered'
  | 'client_message'
  | 'profile_changed'
  | 'agency_consent'
  | 'prelaunch_lead';

/** UI list for /admin/settings — order = display order. */
export const ADMIN_EVENTS: { key: AdminEvent; label: string }[] = [
  { key: 'advertiser_registered', label: 'Advertiser registers' },
  { key: 'verification_pending', label: 'Verification submitted' },
  { key: 'client_registered', label: 'Client registers' },
  { key: 'client_message', label: 'Client messages a professional' },
  { key: 'profile_changed', label: 'Professional edits her profile' },
  { key: 'agency_consent', label: 'Agency submits the founding consent form' },
  { key: 'prelaunch_lead', label: 'Professional pre-registers (pre-launch)' },
];

export const NOTIFY_PREFS_KEY = 'notify:prefs';
const DEFAULT_ON: Record<AdminEvent, boolean> = {
  advertiser_registered: true,
  verification_pending: true,
  client_registered: true,
  client_message: true,
  profile_changed: true,
  agency_consent: true,
  prelaunch_lead: true,
};

/** Merge stored prefs over the all-on defaults. */
export function mergeNotifyPrefs(raw: string | null): Record<AdminEvent, boolean> {
  try {
    return { ...DEFAULT_ON, ...(raw ? (JSON.parse(raw) as Partial<Record<AdminEvent, boolean>>) : {}) };
  } catch {
    return { ...DEFAULT_ON };
  }
}

export function pushoverAdmins(event: AdminEvent, title: string, message: string): void {
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
          const kv = e.SESSION as { get(k: string): Promise<string | null> } | undefined;
          const prefs = mergeNotifyPrefs(kv ? await kv.get(NOTIFY_PREFS_KEY) : null);
          if (!prefs[event]) {
            console.log('[pushover] event off — skipping', event);
            return;
          }
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
            console.log('[pushover] sent:', event, '->', keys.length, 'admin(s)');
          }
        })().catch((err) => console.error('[pushover] send FAILED:', (err as Error).message)),
      );
    } catch (err) {
      console.error('[pushover] hook failed:', (err as Error)?.message ?? err);
    }
  })();
}
