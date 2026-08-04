/**
 * Edge cache for public profile pages (ARCHITECTURE §4: "Cache API on SSR HTML,
 * precise purge"). A profile page is fully public — nothing varies per user (the
 * favourite heart is client-side) — so its rendered HTML is cached in KV and
 * served without touching Postgres (bySlug + similar + reply-speed + settings +
 * the render). The one volatile bit, the live "online" badge, is refreshed
 * client-side after paint (Layout → /avail.json), so a cached shell never shows
 * a stale presence dot.
 *
 * The KV binding is passed in (callers hold `env` from cloudflare:workers) so
 * this module stays import-clean and unit-testable, like the data-layer models.
 *
 * Bust: a single generation counter bumped on ANY profile mutation. Old entries
 * fall out of the key space and expire by TTL.
 * ponytail: global generation bust — coarse on purpose (low edit rate). Go
 * per-slug (store slug→gen) if edit volume makes the whole shelf go cold.
 */
export interface CacheKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const GEN_KEY = 'pc:gen';
const TTL_S = 86_400; // 24h — content freshness comes from the bust, not the TTL.
// Canonical public profile page only: /{locale}/profile/{slug}/ — NOT /avail.json,
// /_server-islands, or anything with a query string.
const PROFILE_RE = /^\/(nl|en|de)\/profile\/[^/]+\/?$/;

export function isCacheableProfile(url: URL): boolean {
  return url.search === '' && PROFILE_RE.test(url.pathname);
}

export async function servedFromCache(kv: CacheKv | undefined, url: URL): Promise<Response | null> {
  if (!kv) return null;
  const gen = (await kv.get(GEN_KEY)) ?? '0';
  const html = await kv.get(`pc:${gen}:${url.pathname}`);
  if (html == null) return null;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-cache': 'HIT' },
  });
}

/** Cache a clean public 200 HTML response, then return an equivalent Response. */
export async function storeInCache(kv: CacheKv | undefined, url: URL, res: Response): Promise<Response> {
  const ct = res.headers.get('content-type') ?? '';
  if (!kv || res.status !== 200 || !ct.includes('text/html') || res.headers.has('set-cookie')) {
    return res;
  }
  const html = await res.text();
  const gen = (await kv.get(GEN_KEY)) ?? '0';
  await kv.put(`pc:${gen}:${url.pathname}`, html, { expirationTtl: TTL_S });
  return new Response(html, { status: 200, headers: { 'content-type': ct, 'x-cache': 'MISS' } });
}

/** Bump the generation so every cached profile page misses on its next hit. */
export async function bustProfiles(kv: CacheKv | undefined): Promise<void> {
  if (!kv) return;
  const next = Number((await kv.get(GEN_KEY)) ?? '0') + 1;
  await kv.put(GEN_KEY, String(next));
}
