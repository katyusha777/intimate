/**
 * Cache-warm cron worker (staging).
 *
 * Replaces the GitHub Actions warm schedule (its every-6h "success" mail was
 * noise). Runs entirely on Cloudflare: a Cron Trigger fires this worker, which
 * warms every live profile page so no visitor pays a cold render (ARCHITECTURE
 * §4). The main Astro worker can't self-fetch its own zone (Cloudflare 522s the
 * loopback), so this is a SEPARATE worker reaching the site through a Service
 * Binding (`SITE`) — an in-process call, not a network round-trip, so there is
 * no loopback to 522.
 *
 * URL source: the public per-locale sitemaps (no shared secret, no DB driver to
 * bundle). Warming = an anonymous GET of each /{locale}/profile/{slug}/ — the
 * main worker's middleware renders it and stores the HTML in KV (page-cache.ts);
 * the `x-cache` header on the reply tells us MISS (freshly cached) vs HIT.
 *
 * Two ways in: the cron `scheduled()` handler (every 6h), and `fetch()` for a
 * manual run that returns a human-readable tally so warming is verifiable.
 */

interface Env {
  // Service binding to the main staging worker (intimate-staging).
  SITE: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
}

const ORIGIN = 'https://staging.intimate.nl';
const LOCALES = ['nl', 'en', 'de'] as const;
const CONCURRENCY = 8;

// Homepages cache with a short TTL (page-cache HOME_TTL_S — live "online now"
// count), so they get their own frequent cron; X-Warm forces a re-store there.
const HOME_URLS = LOCALES.map((l) => `${ORIGIN}/${l}`);
const HOME_CRON = '*/4 * * * *';

/** Pull every live profile URL from the public per-locale sitemaps. */
async function profileUrls(env: Env): Promise<string[]> {
  const urls = new Set<string>();
  for (const locale of LOCALES) {
    const res = await env.SITE.fetch(`${ORIGIN}/sitemap-listings-${locale}.xml`);
    if (!res.ok) continue;
    const xml = await res.text();
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+\/profile\/[^<\s]+)\s*<\/loc>/g)) {
      urls.add(m[1]);
    }
  }
  return [...urls];
}

interface WarmResult {
  total: number;
  ok: number;
  miss: number;
  hit: number;
}

/** Fetch every URL through the binding; the render stores it in KV. */
async function warm(env: Env, urls: string[]): Promise<WarmResult> {
  const r: WarmResult = { total: urls.length, ok: 0, miss: 0, hit: 0 };
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (u) => {
        const res = await env.SITE.fetch(u, { headers: { 'X-Warm': '1' } });
        await res.arrayBuffer(); // drain the body so the render completes
        if (res.ok) r.ok++;
        const cache = res.headers.get('x-cache');
        if (cache === 'MISS') r.miss++;
        else if (cache === 'HIT') r.hit++;
      }),
    );
  }
  return r;
}

export default {
  async scheduled(event: { cron?: string }, env: Env): Promise<void> {
    const homesOnly = event.cron === HOME_CRON;
    const urls = homesOnly ? HOME_URLS : [...HOME_URLS, ...(await profileUrls(env))];
    const r = await warm(env, urls);
    if (!homesOnly) console.log(`[warm] ${r.ok}/${r.total} pages warmed (miss ${r.miss}, hit ${r.hit})`);
  },

  async fetch(_req: Request, env: Env): Promise<Response> {
    const r = await warm(env, [...HOME_URLS, ...(await profileUrls(env))]);
    return new Response(
      `warmed ${r.ok}/${r.total} profiles — freshly cached (MISS): ${r.miss}, already warm (HIT): ${r.hit}\n`,
      { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
    );
  },
};
