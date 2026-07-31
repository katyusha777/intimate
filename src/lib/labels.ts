import * as m from '@/paraglide/messages';
import type { Gender } from './taxonomy';

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
