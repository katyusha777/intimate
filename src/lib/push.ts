/**
 * Push notifications — the ONE send seam (OneSignal REST v2). Swapping the
 * provider later (first-party VAPID) means rewriting THIS file only.
 *
 * Privacy law: payloads are content-free — a generic localized title/body and
 * a deep link. Never a name, never message text, never profile data. Errors
 * log status codes only.
 *
 * Targeting: tag filters, not external ids — `account == <id>` AND
 * `pref_<category> != off`. Per-category prefs live as OneSignal tags set by
 * the client (PushManager), so opting out needs no DB column and the send
 * side needs no pref lookup.
 *
 * `cloudflare:workers` is imported lazily so this module stays importable in
 * bun tests (no workerd) — sendPush just no-ops there.
 */
import * as m from '@/paraglide/messages';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/lib/taxonomy';

export type PushCategory = 'requests' | 'messages';

type MessageFn = (inputs?: object, options?: { locale?: Locale }) => string;
const COPY: Record<PushCategory, { title: MessageFn; body: MessageFn }> = {
  requests: { title: m.push_new_request_title, body: m.push_new_request_body },
  messages: { title: m.push_new_message_title, body: m.push_new_message_body },
};

/**
 * Fire-and-forget: registers the send on waitUntil and returns immediately —
 * a push must never add latency to (or fail) the user action that caused it.
 * @param path site-relative, WITHOUT locale (e.g. `/messages/<id>/`) — the
 *   deep link gets DEFAULT_LOCALE. ponytail: accounts carry no locale; store
 *   one and use it here if mixed-language recipients ever complain.
 */
export function sendPush(opts: { accountId: string; category: PushCategory; path: string; collapseId?: string }): void {
  void (async () => {
    const { env, waitUntil } = await import('cloudflare:workers');
    const e = env as unknown as Record<string, string | undefined>;
    const key = e.ONESIGNAL_API_KEY;
    const appId = e.PUBLIC_ONESIGNAL_APP_ID;
    const origin = e.PUBLIC_SITE_ORIGIN;
    if (!key || !appId || !origin) return; // unconfigured (local/tests) — silent no-op

    const per = (fn: MessageFn) => Object.fromEntries(LOCALES.map((l) => [l, fn({}, { locale: l })]));
    const c = COPY[opts.category];
    waitUntil(
      fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          target_channel: 'push',
          filters: [
            { field: 'tag', key: 'account', relation: '=', value: opts.accountId },
            { operator: 'AND' },
            { field: 'tag', key: `pref_${opts.category}`, relation: '!=', value: 'off' },
          ],
          headings: per(c.title),
          contents: per(c.body),
          web_url: `${origin}/${DEFAULT_LOCALE}${opts.path}`,
          ...(opts.collapseId ? { collapse_id: opts.collapseId } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      }).then(
        (r) => { if (!r.ok) console.error('[push] send failed', r.status); },
        () => console.error('[push] send failed (network)'),
      ),
    );
  })().catch(() => {}); // cloudflare:workers absent (bun tests) — no-op
}
