import * as m from '@/paraglide/messages';
import type {
  Amenity,
  Day,
  Gender,
  IncallLocation,
  Language,
  ListingCategorySlug,
  PaymentMethod,
  RateDuration,
  Service,
  ServiceCategory,
  SortOption,
} from './taxonomy';

/** Dynamic taxonomy-key → i18n label (taxonomy = law: labels only via i18n). */
function taxonomyLabel(key: string, fallback: string): string {
  const fn = (m as Record<string, unknown>)[key];
  return typeof fn === 'function' ? (fn as () => string)() : fallback;
}

/** Localized weekday name; `short` gives the 3-letter form for tight chrome. */
export function dayLabel(d: Day, short = false): string {
  const fn = (m as Record<string, unknown>)[`${short ? 'day_short' : 'day'}_${d}`];
  return typeof fn === 'function' ? (fn as () => string)() : d;
}

/** Taxonomy value → localized label (taxonomy = law: labels only via i18n). */
export function genderLabel(g: Gender): string {
  switch (g) {
    case 'female':
      return m.taxonomy_genders_female();
    case 'male':
      return m.taxonomy_genders_male();
    case 'trans_woman':
      return m.taxonomy_genders_trans_woman();
    case 'trans_man':
      return m.taxonomy_genders_trans_man();
  }
}

/** 47 services → one generated key family; dynamic access beats a 47-arm switch. */
export function serviceLabel(s: Service): string {
  const fn = (m as Record<string, unknown>)[`taxonomy_services_${s}`];
  return typeof fn === 'function' ? (fn as () => string)() : s;
}

export function serviceCategoryLabel(c: ServiceCategory): string {
  const fn = (m as Record<string, unknown>)[`taxonomy_service_categories_${c}`];
  return typeof fn === 'function' ? (fn as () => string)() : c;
}

export function listingCategoryLabel(slug: ListingCategorySlug): string {
  switch (slug) {
    case 'private-visit':
      return m.cat_private();
    case 'escort':
      return m.cat_escort();
    case 'erotic-massage':
      return m.cat_massage();
    case 'virtual-sex':
      return m.cat_virtual();
    case 'bdsm':
      return m.cat_bdsm();
  }
}

/** Rate-table duration (UX-PLAN 2.1) → localized label. */
export function rateDurationLabel(d: RateDuration): string {
  return taxonomyLabel(`taxonomy_rate_durations_${d}`, d);
}

/** Good-to-know taxonomy labels (UX-PLAN 2.5). */
export function languageLabel(l: Language): string {
  return taxonomyLabel(`taxonomy_languages_${l}`, l);
}
export function incallLocationLabel(l: IncallLocation): string {
  return taxonomyLabel(`taxonomy_incall_locations_${l}`, l);
}
export function amenityLabel(a: Amenity): string {
  return taxonomyLabel(`taxonomy_amenities_${a}`, a);
}
export function paymentMethodLabel(pm: PaymentMethod): string {
  return taxonomyLabel(`taxonomy_payment_methods_${pm}`, pm);
}

export function sortLabel(s: SortOption): string {
  switch (s) {
    case 'newest':
      return m.sort_newest();
    case 'recently_online':
      return m.sort_recently_online();
    case 'price_low_high':
      return m.sort_price_low_high();
    case 'price_high_low':
      return m.sort_price_high_low();
  }
}
