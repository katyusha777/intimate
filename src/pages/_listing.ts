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
  /** Visitor's last gender pick (cookie) — URL `?gender=` still wins.
   *  ponytail: cookie-dependent SSR default forks cached HTML per gender —
   *  revisit (vary or client-side) when the edge cache lands. */
  defaultGender?: string;
}

export async function buildListing({ url, locale, category, citySlug, defaultGender }: BuildArgs) {
  const tabPath = category ? `/${locale}/${category.slugs[locale]}/` : `/${locale}/search/`;

  const params: ProfileListParams = {
    ...profileListParamsFromUrl(url, defaultGender),
    ...(category?.filter ?? {}),
    city: citySlug as ProfileListParams['city'],
  };
  const result = await profilesApi.list(params);

  // Saved-compare rail pool (UX-PLAN 6.2, desktop): the whole live set, rendered
  // hidden as compact cards; the client reveals only the saved ones. Same shape
  // as the favorites page. Reuses `result.items` when it already IS the full pool
  // (unfiltered first page) so we don't query twice.
  const savedPool =
    result.items.length === result.total
      ? result.items
      : (await profilesApi.list({ limit: 60 })).items;

  // Answer-first block from live data (SEO.md §3) — same text feeds the meta description.
  const stats = listingStats(result.items.length === result.total ? result.items : result.items);
  const where = citySlug ? cityName(citySlug) : m.where_netherlands();
  const introArgs = { count: result.total, where, min: stats.minPrice, online: stats.online };
  const intro = category
    ? m.seo_intro({ ...introArgs, what: listingCategoryLabel(category.slug) })
    : m.seo_intro_generic(introArgs);
  const updated = stats.updated ? m.updated_label({ date: stats.updated.slice(0, 10) }) : undefined;

  const titleWhat = category ? listingCategoryLabel(category.slug) : m.nav_search();
  const title = m.title_listing({ count: result.total, what: titleWhat, where: citySlug ? where : '' })
    .replace(/\s+–/, ' –')
    .replace(/\s{2,}/g, ' ');
  const heading = category
    ? citySlug
      ? `${listingCategoryLabel(category.slug)} · ${where}`
      : listingCategoryLabel(category.slug)
    : citySlug
      ? where
      : m.nav_search();

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

  return { tabPath, params, result, savedPool, title, heading, intro, updated, canonical, alternates, jsonLd };
}
