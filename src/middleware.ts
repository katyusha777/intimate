import { defineMiddleware } from 'astro:middleware';
import type { APIContext, MiddlewareNext } from 'astro';
import { env } from 'cloudflare:workers';
import { paraglideMiddleware } from '@/paraglide/server';
import { withRequestDb } from '@/db/client';
import { sessionApi } from '@/app/api/session';
import { negotiateLocale } from '@/lib/i18n';
import { BOT_RE, focusRedirect, gate } from '@/lib/gate';
import { HOME_TTL_S, isAnonymousRequest, isCacheableHome, isCacheableProfile, servedFromCache, storeInCache, type CacheKv } from '@/lib/page-cache';
import { captureError } from '@/lib/sentry';

const cacheKv = (): CacheKv | undefined =>
  (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;

// The deployment id (Cloudflare version_metadata) — part of the cache key so a
// new deploy invalidates every cached page automatically. Absent in local dev.
const deployId = (): string =>
  ((env as unknown as { CF_VERSION?: { id?: string } }).CF_VERSION?.id) ?? 'dev';

/**
 * Locale architecture (SEO.md §2): no locale-less URLs. `/` is the ONE exception
 * — it renders the negotiated locale's home IN PLACE (200, no redirect: a
 * bouncing homepage is penalised by Google), canonical'd to /{locale}/. Every
 * page renders inside paraglideMiddleware so getLocale()/m.* resolve the URL's
 * locale per request (AsyncLocalStorage — safe under concurrent requests in one
 * isolate).
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
/**
 * High-traffic legacy URLs from the old site/structure (advertising pages, the
 * old flat /escort/{city}/ shelves, topic pages). Permanent 301 → home keeps the
 * inbound link equity on the apex. Keyed by path with the surrounding slashes
 * stripped. Outlives the pre-launch corridor (which would only 302 them home).
 */
const LEGACY_REDIRECTS = new Set([
  'advertenties',
  'adverteren',
  'lgbt',
  'spaces',
  'escort/amsterdam',
  'escort/rotterdam',
  'escort/den-haag',
  'escort/eindhoven',
  'escort/breda',
]);

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
  // beta.intimate.nl (the pre-launch mirror, retired at launch 2026-08-21):
  // same 301 — the apex IS the site now, and beta serving a duplicate would
  // both leak around the /admin Access wall and split link equity.
  if (['admin.intimate.nl', 'beta.intimate.nl'].includes(context.url.hostname)) {
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

/**
 * Advertiser focus-mode (ONBOARDING.md): a signed-in advertiser whose profile
 * is still draft (unsubmitted) is locked to the setup flow — every product
 * page 302s into it. Runs only for cookie-carrying requests on paths
 * focusRedirect classifies as product (so anonymous/bot traffic never pays the
 * session read, and the read itself is the same 60s-memoized sessionApi call
 * the page/Layout makes anyway — warming it here costs nothing extra). The
 * `profile_submitted` cookie (set by the submitProfile action) bridges the
 * minutes-long Hyperdrive read lag right after she submits, the same pattern
 * as became_advertiser.
 */
const focusModeRedirect = async (context: APIContext, locale: string): Promise<Response | null> => {
  const to = focusRedirect(context.url, locale);
  if (!to) return null;
  if (context.cookies.get('profile_submitted')?.value) return null;
  const session = await sessionApi.current(context);
  if (session?.role !== 'advertiser') return null;
  if ((session.profileState ?? 'draft') !== 'draft') return null;
  return context.redirect(to, 302);
};

const handle = (context: APIContext, next: MiddlewareNext) =>
  // One shared DB client per request (db/client.ts requestDb) — every seam and
  // action inside this request reuses it instead of re-connecting.
  withRequestDb(async () => {
  // Registration wall + focus-mode inputs, computed once (lib/gate.ts). The
  // warm secret check is hoisted from the cache block: the warm cron must pass
  // the wall too, or the home cache would go permanently cold.
  const anonymous = isAnonymousRequest(context.request.headers.get('cookie'));
  const warmSecret = (env as unknown as Record<string, string | undefined>).WARM_SECRET;
  const warmOk = !!warmSecret && context.request.headers.get('x-warm') === warmSecret;
  const visitor = {
    anonymous,
    bot: BOT_RE.test(context.request.headers.get('user-agent') ?? ''),
    warm: warmOk,
    xSheet: context.request.headers.get('x-sheet') === '1',
  };
  if (context.url.pathname === '/') {
    // Root stays a 200 — a redirecting homepage is flagged by Google ("Page with
    // redirect") and drops the apex from the index. Render the negotiated locale's
    // home IN PLACE: effectiveRequestUrl tells paraglide the locale (so getLocale()/
    // m.* resolve AND paraglide's own url-strategy 307 is suppressed) while the
    // browser URL stays `/`. The page still emits canonical/hreflang → /{locale}/,
    // so Google consolidates there; the root simply no longer bounces.
    const locale = negotiateLocale(
      context.request.headers.get('accept-language'),
      context.cookies.get('PARAGLIDE_LOCALE')?.value,
    );
    // Supabase auth links whose redirect_to fell back to the bare Site URL land
    // HERE with ?code= (success) or ?error_code= (expired/used) — never strand
    // them on the homepage. Route the code through /auth/confirm; recovery is
    // the only mail flow that redirects today (signup confirm is off), so the
    // reset form is the right landing.
    if (context.url.searchParams.has('code')) {
      return context.redirect(
        `/auth/confirm?code=${encodeURIComponent(context.url.searchParams.get('code')!)}&next=/auth/reset`,
        302,
      );
    }
    if (context.url.searchParams.has('error_code')) {
      return context.redirect(`/${locale}/auth/expired`, 302);
    }
    // Registration wall: an anonymous human gets the welcome pitch rendered IN
    // PLACE at the root (still a 200 — the apex must never bounce; crawlers
    // never reach this branch, they fall through to the real home below).
    if (anonymous && !visitor.bot && !warmOk) {
      return paraglideMiddleware(context.request, () => next(`/${locale}/welcome/${context.url.search}`), {
        effectiveRequestUrl: new URL(`/${locale}/welcome/`, context.url),
      });
    }
    // Focus-mode: a draft advertiser landing on the apex goes to her flow.
    if (!anonymous) {
      const focused = await focusModeRedirect(context, locale);
      if (focused) return focused;
    }
    // ponytail: `/` renders fresh, not edge-cached (isCacheableHome only matches
    // /{locale}/). Fine for one URL; wire it to the per-locale home cache if root
    // traffic ever justifies it.
    return paraglideMiddleware(context.request, () => next(`/${locale}/${context.url.search}`), {
      effectiveRequestUrl: new URL(`/${locale}/`, context.url),
    });
  }
  // The short link printed in agency emails and said on calls ("intimate.nl
  // slash agencies") — locale-negotiated like `/` (PRE-LAUNCH doc §12).
  if (context.url.pathname === '/agencies' || context.url.pathname === '/agencies/') {
    const locale = negotiateLocale(
      context.request.headers.get('accept-language'),
      context.cookies.get('PARAGLIDE_LOCALE')?.value,
    );
    return context.redirect(`/${locale}/agencies/`, 302);
  }
  // High-traffic legacy URLs → home (301, permanent).
  if (LEGACY_REDIRECTS.has(context.url.pathname.replace(/^\/|\/$/g, ''))) {
    return context.redirect('/', 301);
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

  // Registration wall (lib/gate.ts): anonymous humans get the welcome pitch —
  // /{locale}/ rewritten in place, everything walled 302s home (which then
  // shows the pitch). Crawlers/warm/signed-in fall through untouched. This MUST
  // stay ahead of the cache block: gate responses never enter the shared KV
  // cache (SECURITY.md §5), and walled visitors must never be served from it.
  const g = gate(context.url, visitor);
  if (g.kind === 'redirect') return context.redirect('/', 302);
  if (g.kind === 'rewrite') {
    return paraglideMiddleware(context.request, () => next(g.to));
  }

  // Advertiser focus-mode: draft advertisers browse nothing but their flow.
  if (!anonymous) {
    const pathLocale = context.url.pathname.match(/^\/(nl|en|de|ro|it)(?=\/|$)/)?.[1];
    const focused = await focusModeRedirect(
      context,
      pathLocale ??
        negotiateLocale(
          context.request.headers.get('accept-language'),
          context.cookies.get('PARAGLIDE_LOCALE')?.value,
        ),
    );
    if (focused) return focused;
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
    anonymous
  ) {
    const kv = cacheKv();
    const dep = deployId();
    // The warm cron re-stores homepages BEFORE their short TTL lapses (a plain
    // GET would HIT without extending it) — X-Warm skips the read, not the write.
    // Gated on WARM_SECRET so an anonymous `X-Warm` header can't force a fresh
    // SSR + KV write on every request (an unauthenticated cache-bypass DoS). A
    // wrong/absent secret just serves from cache normally; the warmer (worker +
    // GH action) sends `X-Warm: <WARM_SECRET>`. (warmOk hoisted above — the
    // wall consumes it too.) Post-wall, only crawlers and the warm cron reach
    // this block: the KV page cache is bot/warm-fed by construction.
    const forceStore = cacheableHome && warmOk;
    const hit = forceStore ? null : await servedFromCache(kv, dep, context.url);
    if (hit) return hit;
    const res = await paraglideMiddleware(context.request, () => next());
    return storeInCache(kv, dep, context.url, res, cacheableHome ? HOME_TTL_S : undefined);
  }

  return paraglideMiddleware(context.request, () => next());
  });
