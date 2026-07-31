/**
 * JSON-LD builders (SEO.md §4). Pages compose these and pass them to Layout's
 * `jsonLd` prop. Kept as plain functions so tests can validate output shape.
 */
import type { Profile } from '@/app/models/profile';
import { CITIES } from '@/lib/taxonomy';

const BRAND = 'Intimate';

export function websiteJsonLd(origin: string, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND,
    url: `${origin}/${locale}/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${origin}/${locale}/search/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function organizationJsonLd(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND,
    url: origin,
    logo: `${origin}/img/logo-dark.svg`,
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function itemListJsonLd(profiles: Profile[], origin: string, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: profiles.length,
    itemListElement: profiles.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${origin}/${locale}/profile/${p.slug}/`,
      name: p.name,
    })),
  };
}

/** Data for the answer-first intro blocks (SEO.md §3). */
export function listingStats(profiles: Profile[]) {
  return {
    count: profiles.length,
    online: profiles.filter((p) => p.online).length,
    minPrice: profiles.length ? Math.min(...profiles.map((p) => p.priceFrom)) : 0,
    updated: profiles.reduce((max, p) => (p.createdAt > max ? p.createdAt : max), ''),
  };
}

export function cityName(slug: string): string {
  return CITIES.find((c) => c.slug === slug)?.name ?? slug;
}
