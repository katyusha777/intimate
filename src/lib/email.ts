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
      console.log('[email] queued:', opts.subject, '->', opts.to);
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
          console.log('[email] sent:', opts.subject, '->', opts.to);
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

/** Admin notification helper — target comes from ADMIN_EMAIL. */
function emailAdmin(subject: string, text: string): void {
  void (async () => {
    try {
      const { env } = await import('cloudflare:workers');
      const admin = (env as unknown as Record<string, string | undefined>).ADMIN_EMAIL;
      if (!admin) {
        console.warn('[email] ADMIN_EMAIL unset — skipping', subject);
        return;
      }
      sendEmail({ to: admin, subject, text });
    } catch (err) {
      console.error('[email] admin hook failed:', (err as Error)?.message ?? err);
    }
  })();
}

/** Admin: a new advertiser account just registered (pre-confirmation). */
export function emailAdminNewAdvertiser(email: string): void {
  emailAdmin(
    'New advertiser registration — Intimate',
    `A new advertiser just registered: ${email}\n\nAdmin: https://intimate.nl/admin`,
  );
}

/** Admin: verification documents submitted, review pending. */
export function emailAdminVerificationPending(email: string): void {
  emailAdmin(
    'Verification pending review — Intimate',
    `${email} submitted verification documents.\n\nReview: https://intimate.nl/admin/verification`,
  );
}
