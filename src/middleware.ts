import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { paraglideMiddleware } from '@/paraglide/server';
import { negotiateLocale } from '@/lib/i18n';
import { isAnonymousRequest, isCacheableProfile, servedFromCache, storeInCache, type CacheKv } from '@/lib/page-cache';

const cacheKv = (): CacheKv | undefined =>
  (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;

// The deployment id (Cloudflare version_metadata) — part of the cache key so a
// new deploy invalidates every cached page automatically. Absent in local dev.
const deployId = (): string =>
  ((env as unknown as { CF_VERSION?: { id?: string } }).CF_VERSION?.id) ?? 'dev';

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
 *  `/admin` is locale-less by design (ADMIN.md §1); its language comes from the
 *  PARAGLIDE_LOCALE cookie (strategy: url → cookie → baseLocale), so it still
 *  renders inside paraglideMiddleware below. */
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
  // /admin is locale-less — send /{locale}/admin/* to the real thing.
  const adminPrefixed = context.url.pathname.match(/^\/(?:nl|en|de)(\/admin(?:\/.*)?)$/);
  if (adminPrefixed) return context.redirect(adminPrefixed[1]!, 302);
  if (BYPASS.some((p) => context.url.pathname.startsWith(p))) {
    // Admin renders localized strings (cookie strategy) — needs the wrapper.
    if (context.url.pathname.startsWith('/admin')) {
      return paraglideMiddleware(context.request, () => next());
    }
    return next();
  }

  // Public profile pages: serve the rendered HTML from the edge cache (24h),
  // busted on any profile edit. The live "online" badge is refreshed after
  // paint (Layout → /avail.json), so the cached shell is never stale-online.
  // ANON ONLY: a logged-in page SSRs the user's own header (name/avatar), so
  // caching it would leak one user's identity to everyone (isAnonymousRequest).
  if (
    context.request.method === 'GET' &&
    isCacheableProfile(context.url) &&
    isAnonymousRequest(context.request.headers.get('cookie'))
  ) {
    const kv = cacheKv();
    const dep = deployId();
    const hit = await servedFromCache(kv, dep, context.url);
    if (hit) return hit;
    const res = await paraglideMiddleware(context.request, () => next());
    return storeInCache(kv, dep, context.url, res);
  }

  return paraglideMiddleware(context.request, () => next());
});
