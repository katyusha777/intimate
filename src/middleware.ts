import { defineMiddleware } from 'astro:middleware';
import { paraglideMiddleware } from '@/paraglide/server';
import { negotiateLocale } from '@/lib/i18n';

/**
 * Locale architecture (SEO.md §2): no locale-less URLs. `/` 302-redirects by
 * Accept-Language; every page renders inside paraglideMiddleware so
 * getLocale()/m.* resolve the URL's locale per request (AsyncLocalStorage —
 * safe under concurrent requests in one isolate).
 */
/** Internal, non-localized routes the URL strategy must not redirect.
 *  `/admin` is locale-less by design (ADMIN.md §1) — English-only internal tool. */
const BYPASS = ['/kitchen-sink', '/_actions', '/admin'];

export const onRequest = defineMiddleware((context, next) => {
  if (context.url.pathname === '/') {
    const locale = negotiateLocale(context.request.headers.get('accept-language'));
    return context.redirect(`/${locale}/${context.url.search}`, 302);
  }
  if (BYPASS.some((p) => context.url.pathname.startsWith(p))) return next();
  return paraglideMiddleware(context.request, () => next());
});
