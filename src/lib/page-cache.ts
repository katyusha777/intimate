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
 * Bust: two dimensions in the key — the DEPLOY id and a generation counter.
 * - deployId (Cloudflare version_metadata) changes every deploy, so a code/
 *   template change auto-invalidates every cached page (no manual purge, no 24h
 *   stale window — the class of bug where a redeploy kept serving old HTML).
 * - gen is bumped on ANY profile DATA mutation, invalidating within a deploy.
 * Old entries fall out of the key space and expire by TTL.
 * ponytail: global generation bust — coarse on purpose (low edit rate). Go
 * per-slug (store slug→gen) if edit volume makes the whole shelf go cold.
 */
export interface CacheKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const GEN_KEY = 'pc:gen';
const TTL_S = 86_400; // 24h — content freshness comes from the bust, not the TTL.
// The homepage TTL is short instead: its SSR'd "online now" count has no
// client-side refresh, so freshness DOES come from the TTL here.
export const HOME_TTL_S = 300;
// Canonical public profile page only: /{locale}/profile/{slug}/ — NOT /avail.json,
// /_server-islands, or anything with a query string.
const PROFILE_RE = /^\/(nl|en|de)\/profile\/[^/]+\/?$/;
const HOME_RE = /^\/(nl|en|de)\/?$/;

export function isCacheableProfile(url: URL): boolean {
  return url.search === '' && PROFILE_RE.test(url.pathname);
}

/** The locale homepages — the heaviest SSR (fold counts + two profile strips). */
export function isCacheableHome(url: URL): boolean {
  return url.search === '' && HOME_RE.test(url.pathname);
}

/**
 * ONLY anonymous requests may use the cache. A logged-in page SSRs the user's
 * own header (name/avatar/unread count via Layout → UserMenu), so caching an
 * authenticated response would serve one user's identity to everyone. Supabase
 * (@supabase/ssr) stores the session in an `sb-<ref>-auth-token` cookie (may be
 * chunked with a .0/.1 suffix — the name prefix still matches).
 */
export function isAnonymousRequest(cookieHeader: string | null): boolean {
  return !/(?:^|;\s*)sb-[\w-]*-auth-token/.test(cookieHeader ?? '');
}

// Browsers revalidate rather than heuristically holding the HTML — so a deploy's
// fresh render reaches them on the next navigation, not whenever the heuristic
// TTL happens to lapse. Cheap: a 304 when nothing changed.
const REVALIDATE = 'no-cache';

const cacheKey = (deployId: string, gen: string, pathname: string) => `pc:${deployId}:${gen}:${pathname}`;

export async function servedFromCache(
  kv: CacheKv | undefined,
  deployId: string,
  url: URL,
): Promise<Response | null> {
  if (!kv) return null;
  const gen = (await kv.get(GEN_KEY)) ?? '0';
  const html = await kv.get(cacheKey(deployId, gen, url.pathname));
  if (html == null) return null;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': REVALIDATE, 'x-cache': 'HIT' },
  });
}

/** Cache a clean public 200 HTML response, then return an equivalent Response. */
export async function storeInCache(
  kv: CacheKv | undefined,
  deployId: string,
  url: URL,
  res: Response,
  ttl = TTL_S,
): Promise<Response> {
  const ct = res.headers.get('content-type') ?? '';
  if (!kv || res.status !== 200 || !ct.includes('text/html') || res.headers.has('set-cookie')) {
    return res;
  }
  const html = await res.text();
  const gen = (await kv.get(GEN_KEY)) ?? '0';
  await kv.put(cacheKey(deployId, gen, url.pathname), html, { expirationTtl: ttl });
  return new Response(html, {
    status: 200,
    headers: { 'content-type': ct, 'cache-control': REVALIDATE, 'x-cache': 'MISS' },
  });
}

/** Bump the generation so every cached profile page misses on its next hit. */
export async function bustProfiles(kv: CacheKv | undefined): Promise<void> {
  if (!kv) return;
  const next = Number((await kv.get(GEN_KEY)) ?? '0') + 1;
  await kv.put(GEN_KEY, String(next));
}
