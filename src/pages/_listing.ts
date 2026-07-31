/**
 * Shared listing-page assembly for /{locale}/search, category and city-hub
 * routes (underscore file — not a route). Lives in pages/ because only
 * pages may call app/api (tested).
 */
import * as m from '@/paraglide/messages';
import { profilesApi } from '@/app/api/profiles';
import { profileListParamsFromUrl, type ProfileListParams } from '@/app/models/profile';
import { alternatesFor, samePathAlternates } from '@/lib/i18n';
import { listingCategoryLabel } from '@/lib/labels';
import { breadcrumbJsonLd, cityName, itemListJsonLd, listingStats } from '@/lib/seo';
import { LOCALES, type ListingCategory, type Locale } from '@/lib/taxonomy';

interface BuildArgs {
  url: URL;
  locale: Locale;
  category?: ListingCategory;
  citySlug?: string;
}

export async function buildListing({ url, locale, category, citySlug }: BuildArgs) {
  const tabPath = category ? `/${locale}/${category.slugs[locale]}/` : `/${locale}/search/`;

  const params: ProfileListParams = {
    ...profileListParamsFromUrl(url),
    ...(category?.filter ?? {}),
    city: citySlug as ProfileListParams['city'],
  };
  const result = await profilesApi.list(params);

  // Answer-first block from live data (SEO.md §3) — same text feeds the meta description.
  const stats = listingStats(result.items.length === result.total ? result.items : result.items);
  const what = category ? listingCategoryLabel(category.slug) : m.what_professionals();
  const where = citySlug ? cityName(citySlug) : m.where_netherlands();
  const intro = m.seo_intro({
    count: result.total,
    what,
    where,
    min: stats.minPrice,
    online: stats.online,
  });
  const updated = stats.updated ? m.updated_label({ date: stats.updated.slice(0, 10) }) : undefined;

  const title = m.title_listing({ count: result.total, what, where: citySlug ? where : '' })
    .replace(/\s+–/, ' –')
    .replace(/\s{2,}/g, ' ');
  const heading = citySlug ? `${what === m.what_professionals() ? where : what} · ${where}` : what;

  const citySeg = citySlug ? `${citySlug}/` : '';
  const canonicalPath = `${tabPath}${citySeg}`;
  const canonical = new URL(canonicalPath, url.origin).href;
  const alternates = category
    ? alternatesFor(
        url.origin,
        Object.fromEntries(
          LOCALES.map((l) => [l, `/${l}/${category.slugs[l]}/${citySeg}`]),
        ) as Record<Locale, string>,
      )
    : samePathAlternates(url.origin, canonicalPath.slice(3)); // strip /{locale}

  const jsonLd = [
    itemListJsonLd(result.items, url.origin, locale),
    breadcrumbJsonLd([
      { name: 'Intimate', url: `${url.origin}/${locale}/` },
      { name: heading, url: canonical },
    ]),
  ];

  return { tabPath, params, result, title, heading, intro, updated, canonical, alternates, jsonLd };
}
