import { defineMiddleware } from 'astro:middleware';
import type { APIContext, MiddlewareNext } from 'astro';
import { env } from 'cloudflare:workers';
import { paraglideMiddleware } from '@/paraglide/server';
import { withRequestDb } from '@/db/client';
import { negotiateLocale } from '@/lib/i18n';
import { HOME_TTL_S, isAnonymousRequest, isCacheableHome, isCacheableProfile, servedFromCache, storeInCache, type CacheKv } from '@/lib/page-cache';
import { captureError } from '@/lib/sentry';

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

/**
 * Security headers on every response (securityheaders.com A): defence-in-depth
 * for an adult platform — no framing, no MIME sniffing, and NO REFERRER leaked
 * on outbound clicks (a profile URL in a Referer header is a privacy leak).
 * CSP allows 'unsafe-inline' scripts for now (Astro inline hydration/theme
 * scripts); tightening to hashes is the follow-up, not a blocker.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  // camera/microphone = self: WebRTC voice/video calls need getUserMedia on our
  // own origin (empty () blocked it entirely — "not allowed in this document").
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    // (future) PostHog + Plausible + OneSignal (push SDK, signed-in
    // pages only); Astro's hydration/theme scripts are inline.
    // api.onesignal.com in script-src: the SDK loads its app config via JSONP
    // (a <script> to /sync/<appId>/web) — connect-src alone times init out.
    "script-src 'self' 'unsafe-inline' https://eu-assets.i.posthog.com https://plausible.io https://cdn.onesignal.com https://api.onesignal.com",
    "style-src 'self' 'unsafe-inline'",
    // Own photos ride /media; seed/demo imagery is external https for now.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://eu.i.posthog.com https://plausible.io https://api.onesignal.com https://cdn.onesignal.com",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; '),
};

export const onRequest = defineMiddleware(async (context, next) => {
  // HTTPS is the only front door — the zone accepted plain HTTP with a 200.
  // Local dev is exempt: `astro dev` serves plain http on localhost.
  if (context.url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(context.url.hostname)) {
    return context.redirect(context.url.href.replace(/^http:/, 'https:'), 301);
  }
  // One canonical host: www → apex (SEO.md §2 — no duplicate-content hosts).
  if (context.url.hostname === 'www.intimate.nl') {
    return context.redirect(context.url.href.replace('//www.', '//'), 301);
  }
  // Admin subdomain reverted 2026-08-09 (the experiment coincided with the
  // apex DNS records vanishing) — admin stays at intimate.nl/admin; the
  // Cloudflare Access wall goes on the PATH intimate.nl/admin instead. If the
  // admin host still resolves, send it home.
  if (context.url.hostname === 'admin.intimate.nl') {
    return context.redirect(`https://intimate.nl${context.url.pathname}${context.url.search}`, 301);
  }
  let res: Response;
  try {
    res = await handle(context, next);
  } catch (err) {
    // Sentry sees every SSR/page exception (the whole-site-500 class);
    // rethrow so Astro still renders its error response.
    captureError(err, { url: context.url.href });
    throw err;
  }
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  } catch {
    /* immutable headers (passthrough response) — serve as-is */
  }
  return res;
});

const handle = (context: APIContext, next: MiddlewareNext) =>
  // One shared DB client per request (db/client.ts requestDb) — every seam and
  // action inside this request reuses it instead of re-connecting.
  withRequestDb(async () => {
  if (context.url.pathname === '/') {
    const locale = negotiateLocale(
      context.request.headers.get('accept-language'),
      context.cookies.get('PARAGLIDE_LOCALE')?.value,
    );
    return context.redirect(`/${locale}/${context.url.search}`, 302);
  }
  const legacy = LEGACY_ARTICLES[context.url.pathname.replace(/^\/|\/$/g, '')];
  if (legacy) return context.redirect(`/nl/blog/${legacy}/`, 301);
  // /admin is locale-less — send /{locale}/admin/* to the real thing.
  const adminPrefixed = context.url.pathname.match(/^\/(?:nl|en|de|ro|it)(\/admin(?:\/.*)?)$/);
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
  const cacheableHome = isCacheableHome(context.url);
  if (
    context.request.method === 'GET' &&
    (isCacheableProfile(context.url) || cacheableHome) &&
    isAnonymousRequest(context.request.headers.get('cookie'))
  ) {
    const kv = cacheKv();
    const dep = deployId();
    // The warm cron re-stores homepages BEFORE their short TTL lapses (a plain
    // GET would HIT without extending it) — X-Warm skips the read, not the write.
    const forceStore = cacheableHome && context.request.headers.get('x-warm') === '1';
    const hit = forceStore ? null : await servedFromCache(kv, dep, context.url);
    if (hit) return hit;
    const res = await paraglideMiddleware(context.request, () => next());
    return storeInCache(kv, dep, context.url, res, cacheableHome ? HOME_TTL_S : undefined);
  }

  return paraglideMiddleware(context.request, () => next());
  });
