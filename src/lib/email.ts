/**
 * Outbound transactional email — SMTP2GO over workerd TCP sockets
 * (worker-mailer). Fire-and-forget like push.ts: a mail must never add
 * latency to, or fail, the action that caused it. Silent no-op when the SMTP
 * secrets are unconfigured (local dev, tests) or off-workerd.
 *
 * Email copy lives HERE, not in Paraglide — these aren't UI strings; the
 * advertiser-facing template is bilingual NL/EN by owner decision.
 */

export function sendEmail(opts: { to: string; subject: string; text: string }): void {
  void (async () => {
    try {
      const { env, waitUntil } = await import('cloudflare:workers');
      const e = env as unknown as Record<string, string | undefined>;
      const host = e.SMTP_HOST;
      const user = e.SMTP_USER;
      const pass = e.SMTP_PASS;
      const from = e.EMAIL_FROM;
      if (!host || !user || !pass || !from) {
        console.warn('[email] unconfigured — skipping', opts.subject);
        return;
      }
      // No recipient in logs (SECURITY.md logging discipline) — subject only.
      console.log('[email] queued:', opts.subject);
      // waitUntil wraps the WHOLE chain: `import('worker-mailer')` is a lazy
      // chunk load that yields the event loop — registered any later, the
      // invocation is already done and the send dies silently.
      waitUntil(
        (async () => {
          const { WorkerMailer } = await import('worker-mailer');
          await WorkerMailer.send(
            {
              host,
              port: Number(e.SMTP_PORT ?? 587),
              credentials: { username: user, password: pass },
              authType: 'plain',
              startTls: true,
            },
            { from: { name: 'Intimate', email: from }, to: opts.to, subject: opts.subject, text: opts.text },
          );
          console.log('[email] sent:', opts.subject);
        })().catch((err) => console.error('[email] send FAILED:', opts.subject, (err as Error).message)),
      );
    } catch (err) {
      // Off-workerd (tests, scripts) this throws on the cloudflare:workers
      // import — fine. Anywhere else, be LOUD: a silent catch here once hid a
      // dead send path entirely.
      console.error('[email] hook failed before send:', (err as Error)?.message ?? err);
    }
  })();
}

/** Advertiser notification: profile verified & live (bilingual NL/EN). */
export function emailProfileApproved(to: string, slug?: string): void {
  const nlUrl = slug ? `https://intimate.nl/nl/profile/${slug}/` : 'https://intimate.nl/nl/account/';
  const enUrl = slug ? `https://intimate.nl/en/profile/${slug}/` : 'https://intimate.nl/en/account/';
  sendEmail({
    to,
    subject: 'Je profiel staat live · Your profile is live — Intimate',
    text: [
      'Goed nieuws!',
      '',
      'Je profiel is geverifieerd en staat nu live op Intimate.',
      nlUrl,
      '',
      '—',
      '',
      'Good news!',
      '',
      'Your profile has been verified and is now live on Intimate.',
      enUrl,
      '',
      '— Intimate · intimate.nl',
    ].join('\n'),
  });
}

/** Professional notification: a client message/request is waiting (NL/EN).
 *  Throttled by the caller to the start of an unread burst — never per message. */
export function emailNewMessage(to: string, threadId: string): void {
  sendEmail({
    to,
    subject: 'Nieuw bericht op Intimate · New message on Intimate',
    text: [
      'Je hebt een nieuw bericht op Intimate.',
      `Lezen en beantwoorden: https://intimate.nl/nl/messages/${threadId}/`,
      '',
      '—',
      '',
      'You have a new message on Intimate.',
      `Read and reply: https://intimate.nl/en/messages/${threadId}/`,
      '',
      '— Intimate · intimate.nl',
    ].join('\n'),
  });
}

// Admin-event notifications live in lib/pushover.ts (pushoverAdmins) —
// admin EMAILS for registration/verification were turned off 2026-08-10
// (owner decision); this module is user-facing mail only.
