import * as m from '@/paraglide/messages';
import type { Gender, Service } from './taxonomy';

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
    case 'non_binary':
      return m.taxonomy_genders_non_binary();
  }
}

/** 47 services → one generated key family; dynamic access beats a 47-arm switch. */
export function serviceLabel(s: Service): string {
  const fn = (m as Record<string, unknown>)[`taxonomy_services_${s}`];
  return typeof fn === 'function' ? (fn as () => string)() : s;
}
