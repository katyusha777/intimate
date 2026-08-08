/**
 * Retention-purge cron worker — NOT the app worker.
 *
 * A daily Cron Trigger fires this worker, which POSTs the main Astro worker's
 * bearer-gated /api/purge endpoint through a Service Binding (`SITE`) — an
 * in-process call, so no DNS / self-fetch / 522 loopback, and no DB driver
 * bundled here. The endpoint does the actual deletes with the main worker's
 * DB + R2 bindings (src/lib/purge.ts):
 *   · messages past their 90-day window (SECURITY.md §8)
 *   · verification-doc bytes past retention (hard rule 3; row kept)
 *
 * Two ways in: the cron `scheduled()` handler, and `fetch()` for a manual run
 * that returns the tally so a purge is verifiable.
 */

interface Env {
  // Service binding to the main app worker of the same tier (wrangler.jsonc).
  SITE: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
  // Shared secret the /api/purge endpoint checks (same value on both workers).
  PURGE_SECRET: string;
  // Per-tier site origin (wrangler.jsonc vars).
  ORIGIN: string;
}

async function run(env: Env): Promise<string> {
  const res = await env.SITE.fetch(`${env.ORIGIN}/api/purge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PURGE_SECRET}`,
      // Astro's CSRF guard rejects state-changing requests whose Origin doesn't
      // match the host — a service-binding fetch sends none, so set it.
      Origin: env.ORIGIN,
    },
  });
  const body = await res.text();
  return `purge ${res.status}: ${body}`;
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    console.log('[purge]', await run(env));
  },

  async fetch(_req: Request, env: Env): Promise<Response> {
    return new Response(`${await run(env)}\n`, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
