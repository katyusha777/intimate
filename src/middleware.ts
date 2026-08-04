import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { paraglideMiddleware } from '@/paraglide/server';
import { negotiateLocale } from '@/lib/i18n';
import { isCacheableProfile, servedFromCache, storeInCache, type CacheKv } from '@/lib/page-cache';

const cacheKv = (): CacheKv | undefined =>
  (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;

/**
 * Locale architecture (SEO.md §2): no locale-less URLs. `/` 302-redirects by
 * Accept-Language; every page renders inside paraglideMiddleware so
 * getLocale()/m.* resolve the URL's locale per request (AsyncLocalStorage —
 * safe under concurrent requests in one isolate).
 *
 * The home ALWAYS shows the full national shelf — the chosen `city` cookie is a
 * saved preference surfaced as a one-tap chip on the fold (index.astro), never
 * a forced redirect: a per-cookie home would fork cached HTML, and the city
 * already has its own canonical shelf at /{locale}/{city}/ (SEO.md §2).
 */
/** Internal, non-localized routes the URL strategy must not redirect.
 *  `/admin` is locale-less by design (ADMIN.md §1) — English-only internal tool. */
const BYPASS = ['/kitchen-sink', '/_actions', '/admin', '/auth', '/media', '/api'];

/**
 * Legacy article URLs (old flat, locale-less, Dutch) → new /nl/blog/{slug}/.
 * These ranked in Google; a 301 preserves the equity. Keyed by old slug.
 */
const LEGACY_ARTICLES: Record<string, string> = {
  'ontdek-de-intimate-app-een-nieuwe-dimensie-in-erotisch-plezier-voor-jouw-mobiel':
    'ontdek-de-intimate-app',
  'verleidelijke-achtergronden-van-intimate-nl-gratis-download': 'gratis-wallpapers',
  'starten-als-escort-in-nederland-richtlijnen-tips-en-ondersteuning':
    'starten-als-escort-in-nederland',
  'de-girlfriend-experience-gfe-een-diepere-duik-in-intimiteit-en-connectie':
    'girlfriend-experience-gfe',
  'veiligheid-eerst-richtlijnen-voor-sekswerkers-om-veilig-aan-de-slag-te-gaan':
    'veilig-werken-als-sekswerker',
  'welkom-bij-intimate': 'welkom-bij-intimate',
};

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname === '/') {
    const locale = negotiateLocale(context.request.headers.get('accept-language'));
    return context.redirect(`/${locale}/${context.url.search}`, 302);
  }
  const legacy = LEGACY_ARTICLES[context.url.pathname.replace(/^\/|\/$/g, '')];
  if (legacy) return context.redirect(`/nl/blog/${legacy}/`, 301);
  if (BYPASS.some((p) => context.url.pathname.startsWith(p))) return next();

  // Public profile pages: serve the rendered HTML from the edge cache (24h),
  // busted on any profile edit. The live "online" badge is refreshed after
  // paint (Layout → /avail.json), so the cached shell is never stale-online.
  if (context.request.method === 'GET' && isCacheableProfile(context.url)) {
    const kv = cacheKv();
    const hit = await servedFromCache(kv, context.url);
    if (hit) return hit;
    const res = await paraglideMiddleware(context.request, () => next());
    return storeInCache(kv, context.url, res);
  }

  return paraglideMiddleware(context.request, () => next());
});
