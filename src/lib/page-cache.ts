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
// Post-bust store guard: Hyperdrive's read cache serves pre-mutation rows for
// minutes after a write, so a page rendered right after a bust can be the OLD
// content — storing it under the new generation would resurrect it for the
// full TTL (a deleted profile outliving its GDPR approval by 24h). Within the
// window, reads still miss (new gen) and SSR simply goes uncached.
const BUST_WINDOW_MS = 10 * 60_000;

/** GEN_KEY holds `<n>:<bustedAtMs>`; legacy plain `<n>` parses as bustedAt 0. */
const parseGen = (raw: string | null): { gen: string; at: number } => {
  const [gen = '0', at = '0'] = (raw ?? '0').split(':');
  return { gen, at: Number(at) || 0 };
};
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

// Host stays part of the key (cheap, and safe if a second serving host ever
// returns — beta taught us two hosts sharing `/{locale}/` poison each other).
// The Amsterdam calendar date is part of the key too: cached pages bake in
// date-dependent UI (the hours table's "today" bold, the DateStrip), so a 24h
// TTL must still roll over at the market's midnight, not the store time +24h.
const amsDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
const cacheKey = (deployId: string, gen: string, url: URL) => `pc:${deployId}:${gen}:${amsDay()}:${url.host}${url.pathname}`;

export async function servedFromCache(
  kv: CacheKv | undefined,
  deployId: string,
  url: URL,
): Promise<Response | null> {
  if (!kv) return null;
  const { gen } = parseGen(await kv.get(GEN_KEY));
  const html = await kv.get(cacheKey(deployId, gen, url));
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
  const { gen, at } = parseGen(await kv.get(GEN_KEY));
  if (Date.now() - at < BUST_WINDOW_MS) return res;
  const html = await res.text();
  await kv.put(cacheKey(deployId, gen, url), html, { expirationTtl: ttl });
  return new Response(html, {
    status: 200,
    headers: { 'content-type': ct, 'cache-control': REVALIDATE, 'x-cache': 'MISS' },
  });
}

/** Bump the generation so every cached profile page misses on its next hit. */
export async function bustProfiles(kv: CacheKv | undefined): Promise<void> {
  if (!kv) return;
  const { gen } = parseGen(await kv.get(GEN_KEY));
  await kv.put(GEN_KEY, `${Number(gen) + 1}:${Date.now()}`);
}
