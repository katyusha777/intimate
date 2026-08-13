/**
 * Locale routing helpers (SEO.md §2). One canonical URL shape: EVERY page
 * lives under /{nl|en|de}/ — no locale-less duplicates. `/` renders the
 * negotiated locale's home in place (200, canonical'd to /{locale}/ — no
 * redirect); x-default points at /nl/ (the NL-market default).
 */
import { getLocale } from '@/paraglide/runtime';
import { LOCALES, type Locale } from '@/lib/taxonomy';

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Prefix an app path with the current (or given) locale. */
export function localizePath(path: string, locale: Locale = getLocale() as Locale): string {
  return `/${locale}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Accept-Language negotiation; NL is the default (Dutch market), so `/` lands
 *  on /nl/ unless the browser explicitly prefers another supported locale. */
export function negotiateLocale(acceptLanguage: string | null, cookie?: string | null): Locale {
  // A remembered pick (language switchers write PARAGLIDE_LOCALE) beats the
  // browser's Accept-Language (items.md #5).
  if (cookie && isLocale(cookie)) return cookie;
  for (const part of (acceptLanguage ?? '').toLowerCase().split(',')) {
    const tag = part.trim().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return 'nl';
}

/**
 * Absolute alternate URLs for hreflang, given each locale's PATH (paths may
 * differ per locale — localized category slugs).
 */
export function alternatesFor(
  origin: string,
  pathByLocale: Record<Locale, string>,
): Record<Locale, string> {
  return Object.fromEntries(
    LOCALES.map((l) => [l, new URL(pathByLocale[l], origin).href]),
  ) as Record<Locale, string>;
}

/** Same path in every locale (pages without localized slugs). */
export function samePathAlternates(origin: string, path: string): Record<Locale, string> {
  return alternatesFor(
    origin,
    Object.fromEntries(LOCALES.map((l) => [l, `/${l}${path}`])) as Record<Locale, string>,
  );
}
