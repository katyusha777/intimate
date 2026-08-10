/**
 * Sentry error capture (owner decision 2026-08-10 — supersedes the earlier
 * "PostHog is the error tracker" plan; ANALYTICS.md updated). No SDK: the
 * envelope ingest API is one fetch, and the official SDKs can't wrap the
 * Astro-adapter worker entry anyway. DSN = wrangler var SENTRY_DSN (public
 * by design — same value browser SDKs expose).
 *
 * Fire-and-forget on waitUntil; called from the middleware catch (SSR/page
 * errors) and available for manual capture. Static cloudflare:workers import
 * is safe here: only middleware imports this module (never in bun's graph).
 */
import { env, waitUntil } from 'cloudflare:workers';

export function captureError(err: unknown, ctx?: { url?: string; extra?: Record<string, unknown> }): void {
  try {
    const e = env as unknown as { SENTRY_DSN?: string; CF_VERSION?: { id?: string } };
    const m = e.SENTRY_DSN?.match(/^https:\/\/([a-f0-9]+)@([^/]+)\/(\d+)$/);
    if (!m) return; // unconfigured/malformed — silent no-op
    const [, key, host, project] = m;
    // Drop the query string before it leaves the worker: recovery/confirm links
    // carry token_hash and other paths carry PII in ?params — Sentry must only
    // ever see the path (SECURITY.md logging discipline). Root-cause: strip here
    // so no caller can leak a query string regardless of what it passes.
    const safeUrl = ctx?.url?.split('?')[0];
    const error = err instanceof Error ? err : new Error(String(err));
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const sentAt = new Date().toISOString();
    const event = {
      event_id: eventId,
      timestamp: sentAt,
      platform: 'javascript',
      level: 'error',
      environment: 'production',
      release: e.CF_VERSION?.id,
      exception: { values: [{ type: error.name, value: error.message }] },
      extra: { stack: error.stack, ...ctx?.extra },
      request: safeUrl ? { url: safeUrl } : undefined,
    };
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: sentAt }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
    waitUntil(
      fetch(`https://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: envelope,
      })
        .then((r) => {
          if (!r.ok) console.warn('[sentry] rejected:', r.status);
        })
        .catch((err2) => console.warn('[sentry] send failed:', (err2 as Error).message)),
    );
  } catch (err3) {
    console.warn('[sentry] capture failed:', (err3 as Error)?.message ?? err3);
  }
}
