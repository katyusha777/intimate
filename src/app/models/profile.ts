/**
 * Profile domain model (docs/API.md). Zod is the source of truth: the schema
 * validates data at the backend boundary and derives the TS types. Enums come
 * from taxonomy (taxonomy = law).
 */
import { z } from 'zod';
import { getLocale } from '@/paraglide/runtime';
import {
  ALL_SERVICES,
  CITIES,
  GENDERS,
  LOCALES,
  MEETING_TYPES,
  PROFILE_STATES,
  SERVICE_CATEGORIES,
  SORT_OPTIONS,
  type CitySlug,
  type Locale,
  type Service,
} from '@/lib/taxonomy';

const CITY_SLUGS = CITIES.map((c) => c.slug) as unknown as [CitySlug, ...CitySlug[]];
const SERVICE_VALUES = ALL_SERVICES as unknown as [Service, ...Service[]];

export const ProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  /** Lifecycle state — public reads must only ever surface 'live'. */
  state: z.enum(PROFILE_STATES),
  name: z.string(),
  age: z.number().int().min(18), // mirrors the DB hard floor (ARCHITECTURE §8.4)
  gender: z.enum(GENDERS),
  city: z.enum(CITY_SLUGS),
  verified: z.boolean(),
  online: z.boolean(),
  featured: z.boolean(),
  priceFrom: z.number().int().positive(), // EUR
  services: z.array(z.enum(SERVICE_VALUES)),
  meetingTypes: z.array(z.enum(MEETING_TYPES)),
  /** Original description as written by the advertiser (their language). */
  description: z.string(),
  /** Managed translations per locale; UI reads via localizedDescription(). */
  descriptionTranslations: z.partialRecord(z.enum(LOCALES), z.string()).default({}),
  photos: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Description in the current locale, falling back to the original text. */
export function localizedDescription(p: Profile, locale: Locale = getLocale() as Locale): string {
  return p.descriptionTranslations[locale] ?? p.description;
}

export const PAGE_SIZE = 24;

export const ProfileListParamsSchema = z.object({
  /** Free-text query (name/tagline/city/services). AI search rides this later. */
  q: z.string().trim().max(200).optional(),
  city: z.enum(CITY_SLUGS).optional(),
  /** Multi-select (checkbox chips); matches ANY — "Woman + Trans woman" is a real search. */
  genders: z.array(z.enum(GENDERS)).default([]),
  /** Multi-select; a profile matches when it offers ANY of these. */
  services: z.array(z.enum(SERVICE_VALUES)).default([]),
  serviceCategory: z.enum(SERVICE_CATEGORIES).optional(),
  meetingType: z.enum(MEETING_TYPES).optional(),
  priceMin: z.number().int().min(0).optional(),
  priceMax: z.number().int().min(0).optional(),
  onlineOnly: z.boolean().default(false),
  featuredOnly: z.boolean().default(false),
  verifiedOnly: z.boolean().default(false),
  sort: z.enum(SORT_OPTIONS).default('newest'),
  limit: z.number().int().min(0).max(60).default(PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});
export type ProfileListParams = z.input<typeof ProfileListParamsSchema>;

export interface ProfileList {
  items: Profile[];
  /** Total matches before limit/offset — pagination + counts come for free. */
  total: number;
}

/** Contract every backend implements (json today, Drizzle/Supabase later). */
export interface ProfilesApi {
  list(params?: ProfileListParams): Promise<ProfileList>;
  bySlug(slug: string): Promise<Profile | null>;
}

/**
 * Parse listing filters from a page URL (GET-form params). Invalid values are
 * dropped, never thrown — a mangled URL is a default listing, not a 500.
 */
export function profileListParamsFromUrl(url: URL): ProfileListParams {
  const sp = url.searchParams;
  const opt = (key: string) => sp.get(key) || undefined;
  const num = (key: string) => {
    const n = Number(sp.get(key));
    return Number.isFinite(n) && sp.get(key) !== '' && sp.get(key) !== null ? n : undefined;
  };
  const page = Math.max(1, Math.trunc(num('page') ?? 1));

  const candidate = {
    q: opt('q'),
    city: opt('city'),
    genders: sp.getAll('genders'),
    services: sp.getAll('services'),
    meetingType: opt('visit'),
    priceMin: num('priceMin'),
    priceMax: num('priceMax'),
    onlineOnly: sp.has('online'),
    verifiedOnly: sp.has('verified'),
    sort: opt('sort'),
    offset: (page - 1) * PAGE_SIZE,
  };

  const parsed = ProfileListParamsSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // strip invalid enum values field-by-field instead of failing the page
  const loose: Record<string, unknown> = { ...candidate };
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete loose[key];
  }
  const retry = ProfileListParamsSchema.safeParse(loose);
  return retry.success ? retry.data : {};
}
