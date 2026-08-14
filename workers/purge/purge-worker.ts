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
  // Gates the MANUAL fetch() runs (this worker only, independent of
  // PURGE_SECRET). Unset → manual runs disabled (fail closed); the cron
  // scheduled() path never needs it.
  TICK_KEY?: string;
  // Per-tier site origin (wrangler.jsonc vars).
  ORIGIN: string;
}

// Dispatch keys on the DAILY purge expression (must match wrangler.jsonc
// verbatim); every OTHER trigger is the agency-crawl tick (/api/crawl-tick).
// Keyed this way round because the crawl cadence is the tunable one — retuning
// it can't silently turn the crawler into a 5-minute purge.
const PURGE_CRON = '17 3 * * *';

async function run(env: Env, endpoint: 'purge' | 'crawl-tick'): Promise<string> {
  const res = await env.SITE.fetch(`${env.ORIGIN}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PURGE_SECRET}`,
      // Astro's CSRF guard rejects state-changing requests whose Origin doesn't
      // match the host — a service-binding fetch sends none, so set it.
      Origin: env.ORIGIN,
    },
  });
  const body = await res.text();
  return `${endpoint} ${res.status}: ${body}`;
}

export default {
  async scheduled(event: { cron?: string }, env: Env): Promise<void> {
    if (event.cron === PURGE_CRON) {
      console.log('[purge]', await run(env, 'purge'));
    } else {
      console.log('[crawl]', await run(env, 'crawl-tick'));
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    // Manual runs are TICK_KEY-gated: the workers.dev URL was an open (if
    // idempotent) trigger — a door is a door. Fail closed when unset.
    if (!env.TICK_KEY || req.headers.get('authorization') !== `Bearer ${env.TICK_KEY}`) {
      return new Response('forbidden', { status: 403 });
    }
    // Manual runs: /…?crawl ticks the crawler; default is the purge.
    const endpoint = new URL(req.url).searchParams.has('crawl') ? 'crawl-tick' : 'purge';
    return new Response(`${await run(env, endpoint)}\n`, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
