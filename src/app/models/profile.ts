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
  DAYS,
  GENDERS,
  LOCALES,
  MEETING_TYPES,
  PROFILE_STATES,
  SERVICE_CATEGORIES,
  SORT_OPTIONS,
  type CitySlug,
  type Day,
  type Locale,
  type Service,
} from '@/lib/taxonomy';

/** Opening hours for one day: closed, all-day, or a from–to range (HH:MM). */
export const DayHoursSchema = z.object({
  closed: z.boolean().default(false),
  allDay: z.boolean().default(false),
  from: z.string().default(''),
  to: z.string().default(''),
});
export type DayHours = z.infer<typeof DayHoursSchema>;
export const OpeningHoursSchema = z.partialRecord(z.enum(DAYS), DayHoursSchema);
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

const CITY_SLUGS = CITIES.map((c) => c.slug) as unknown as [CitySlug, ...CitySlug[]];
const SERVICE_VALUES = ALL_SERVICES as unknown as [Service, ...Service[]];

export const ProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  /** Lifecycle state — public reads must only ever surface 'live'. */
  state: z.enum(PROFILE_STATES),
  name: z.string(),
  /** Date of birth (YYYY-MM-DD); displayed age is computed via profileAge(). */
  birthDate: z.iso.date(),
  gender: z.enum(GENDERS),
  city: z.enum(CITY_SLUGS),
  verified: z.boolean(),
  online: z.boolean(),
  featured: z.boolean(),
  priceFrom: z.number().int().positive(), // EUR
  services: z.array(z.enum(SERVICE_VALUES)),
  meetingTypes: z.array(z.enum(MEETING_TYPES)),
  /** Availability per weekday (optional — absent = not specified). */
  openingHours: OpeningHoursSchema.default({}),
  /**
   * Last time presence was seen (ISO datetime). Mock now; the realtime
   * (Supabase presence) upgrade swaps the input, not the availability helper.
   * Optional — absent = never seen.
   */
  lastActiveAt: z.iso.datetime().optional(),
  /** Original description as written by the advertiser (their language). */
  description: z.string(),
  /** Managed translations per locale; UI reads via localizedDescription(). */
  descriptionTranslations: z.partialRecord(z.enum(LOCALES), z.string()).default({}),
  photos: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Age in whole years from a YYYY-MM-DD birth date (the DB stores the date). */
export function profileAge(birthDate: string, now: Date = new Date()): number {
  const b = new Date(birthDate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

/** DOB for someone who is exactly `age` today — used to seed/mock data. */
export function birthDateForAge(age: number, now: Date = new Date()): string {
  return `${now.getFullYear() - age}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Description in the current locale, falling back to the original text. */
export function localizedDescription(p: Profile, locale: Locale = getLocale() as Locale): string {
  return p.descriptionTranslations[locale] ?? p.description;
}

/**
 * The three honest availability states (UX-PLAN 1.3). One helper is the single
 * source of truth: cards, profile and the sticky card all derive from it, and
 * the realtime upgrade swaps `p.online`/`p.lastActiveAt` inputs, not the UI.
 *
 *   online       → ● presence flag is on
 *   today_until  → ◐ open today (now or later); `until` = today's closing HH:MM
 *   back_at      → ○ not open today; `nextDay` = next open weekday (DAYS value)
 *
 * `lastActiveLabel` (e.g. "14:20") is the wall-clock of lastActiveAt when it
 * falls on `now`'s local day — the honest "active today HH:MM" line for offline
 * cards. Times are computed in Europe/Amsterdam (the market's timezone) so a
 * server in any region reads the same clock as the professional and client.
 */
export type AvailabilityKind = 'online' | 'today_until' | 'back_at';
export interface Availability {
  kind: AvailabilityKind;
  /** today_until: closing time "HH:MM". */
  until?: string;
  /** back_at: next open weekday (a DAYS value: 'mon'…'sun'). */
  nextDay?: Day;
  /** "HH:MM" of lastActiveAt when it is on `now`'s local day, else undefined. */
  lastActiveToday?: string;
}

const TZ = 'Europe/Amsterdam';
const DOW: readonly Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as unknown as Day[];

/** Wall-clock parts of an instant in the Amsterdam timezone. */
function amsParts(d: Date): { day: Day; minutes: number; hhmm: string } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday').toLowerCase().slice(0, 3) as Day;
  let hh = get('hour');
  if (hh === '24') hh = '00'; // some engines emit 24:00 for midnight
  const mm = get('minute');
  return { day: wd, minutes: Number(hh) * 60 + Number(mm), hhmm: `${hh}:${mm}` };
}

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Is the professional's day open at (or later than) `nowMin`? */
function openTodayUntil(day: DayHours | undefined, nowMin: number): string | null {
  if (!day || day.closed) return null;
  if (day.allDay) return '24:00';
  const to = toMinutes(day.to);
  if (to === null) return null;
  // Open now, or opens later today, and there's still time before close.
  return to > nowMin ? day.to : null;
}

export function availabilityState(p: Profile, now: Date = new Date()): Availability {
  const { day, minutes } = amsParts(now);
  const dayIdx = DOW.indexOf(day);

  // "active today HH:MM" — only when lastActiveAt lands on the same local day.
  let lastActiveToday: string | undefined;
  if (p.lastActiveAt) {
    const la = amsParts(new Date(p.lastActiveAt));
    if (la.day === day) lastActiveToday = la.hhmm;
  }

  if (p.online) return { kind: 'online', lastActiveToday };

  const until = openTodayUntil(p.openingHours[day], minutes);
  if (until) return { kind: 'today_until', until, lastActiveToday };

  // Not open today → next open weekday (scan the coming 7 days).
  for (let i = 1; i <= 7; i++) {
    const d = DOW[(dayIdx + i) % 7]!;
    const dh = p.openingHours[d];
    if (dh && !dh.closed && (dh.allDay || toMinutes(dh.to) !== null)) {
      return { kind: 'back_at', nextDay: d, lastActiveToday };
    }
  }
  return { kind: 'back_at', lastActiveToday };
}

export const PAGE_SIZE = 24;

export const ProfileListParamsSchema = z.object({
  /** Free-text query (name/tagline/city/services). AI search rides this later. */
  q: z.string().trim().max(200).optional(),
  /** Main city (URL path segment) — the primary location state. */
  city: z.enum(CITY_SLUGS).optional(),
  /** Extra cities from the filter panel; effective set = union(city, cities). */
  cities: z.array(z.enum(CITY_SLUGS)).default([]),
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
    cities: sp.getAll('cities'),
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
