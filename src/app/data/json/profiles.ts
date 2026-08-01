/**
 * JSON backend for profiles — the "database" until the real schema lands
 * (docs/API.md). Mirrors the semantics the Drizzle/Supabase backend must keep:
 * public reads only surface `live` profiles; params are Zod-validated.
 */
import { z } from 'zod';
import {
  ProfileListParamsSchema,
  ProfileSchema,
  type Profile,
  type ProfilesApi,
} from '@/app/models/profile';
import { CITIES, SERVICES } from '@/lib/taxonomy';
import raw from './profiles.json';

const ALL = z.array(ProfileSchema).parse(raw);
// Visibility rule enforced at the backend, exactly like the DB backend will.
const LIVE = ALL.filter((p) => p.state === 'live');

const CITY_NAME = new Map(CITIES.map((c) => [c.slug, c.name.toLowerCase()]));

const SORTERS: Record<string, (a: Profile, b: Profile) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  recently_online: (a, b) =>
    Number(b.online) - Number(a.online) || b.createdAt.localeCompare(a.createdAt),
  price_low_high: (a, b) => a.priceFrom - b.priceFrom,
  price_high_low: (a, b) => b.priceFrom - a.priceFrom,
};

/** Naive full-text match — the SQL backend swaps this for Postgres FTS. */
function matchesQuery(p: Profile, q: string): boolean {
  const hay = [p.name, p.description, ...Object.values(p.descriptionTranslations), CITY_NAME.get(p.city) ?? '', ...p.services.map((s) => s.replaceAll('_', ' '))]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export const profilesApi: ProfilesApi = {
  async list(params = {}) {
    const q = ProfileListParamsSchema.parse(params);
    const categoryServices = q.serviceCategory
      ? new Set<string>(SERVICES[q.serviceCategory])
      : null;
    // Location = union of the main city (path) and extra sidebar cities.
    const citySet = new Set([...(q.city ? [q.city] : []), ...q.cities]);

    const rows = LIVE.filter(
      (p) =>
        (!q.q || matchesQuery(p, q.q)) &&
        (citySet.size === 0 || citySet.has(p.city)) &&
        (q.genders.length === 0 || q.genders.includes(p.gender)) &&
        (q.services.length === 0 || q.services.some((s) => p.services.includes(s))) &&
        (!categoryServices || p.services.some((s) => categoryServices.has(s))) &&
        (!q.meetingType || p.meetingTypes.includes(q.meetingType)) &&
        (q.priceMin === undefined || p.priceFrom >= q.priceMin) &&
        (q.priceMax === undefined || p.priceFrom <= q.priceMax) &&
        (!q.onlineOnly || p.online) &&
        (!q.featuredOnly || p.featured) &&
        (!q.verifiedOnly || p.verified),
    ).sort(SORTERS[q.sort]);

    return { items: rows.slice(q.offset, q.offset + q.limit), total: rows.length };
  },

  async bySlug(slug) {
    return LIVE.find((p) => p.slug === slug) ?? null;
  },
};
