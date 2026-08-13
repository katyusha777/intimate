/**
 * Profile domain model (docs/API.md). Zod is the source of truth: the schema
 * validates data at the backend boundary and derives the TS types. Enums come
 * from taxonomy (taxonomy = law).
 */
import { z } from 'zod';
import { getLocale } from '@/paraglide/runtime';
import {
  ALL_SERVICES,
  AMENITIES,
  APPEARANCES,
  AVAILABLE_FOR,
  BODY_TYPES,
  BREAST_TYPES,
  CITIES,
  CITY_SLUGS,
  CUP_SIZES,
  DAYS,
  DRINKING,
  EYE_COLORS,
  GENDERS,
  HAIR_COLORS,
  HAIR_LENGTHS,
  INCALL_LOCATIONS,
  LANGUAGES,
  LOCALES,
  MEETING_TYPES,
  NUMERIC_RANGES,
  PAYMENT_METHODS,
  PIERCINGS,
  PROFILE_STATES,
  PUBIC_HAIR,
  RATE_DURATIONS,
  SERVICE_CATEGORIES,
  SERVICES,
  SMOKING,
  SORT_OPTIONS,
  TATTOOS,
  type Day,
  type Locale,
  type ProfileState,
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

/**
 * One calendar date's availability override (agency schedules: kimnl-style
 * "BESCHIKBAAR / AFWEZIG per date"). Keyed by ISO date; a date entry beats the
 * weekly `openingHours` for that day, weekly stays the fallback. `from`/`to`
 * optional — absent = the whole day. Past dates are ignored at read time.
 */
export const DateAvailabilitySchema = z.object({
  available: z.boolean(),
  from: z.string().default(''),
  to: z.string().default(''),
});
export type DateAvailability = z.infer<typeof DateAvailabilitySchema>;
export const AvailabilityDatesSchema = z.record(z.iso.date(), DateAvailabilitySchema);
export type AvailabilityDates = z.infer<typeof AvailabilityDatesSchema>;

const SERVICE_VALUES = ALL_SERVICES as unknown as [Service, ...Service[]];

/**
 * One rate row (UX-PLAN 2.1): either a PRESET duration or a free-text custom
 * item ("15 minutes phone call"), with an incall and/or outcall price. At
 * least one price must be set — a row with no price is noise. Array order IS
 * the display order (the editor sorts custom items).
 * `priceFrom` is DERIVED (ratesMinPrice over duration rows), never authored.
 */
export const RateRowSchema = z
  .object({
    /** Preset time row — mutually fallback with `label`. */
    duration: z.enum(RATE_DURATIONS).optional(),
    /** Her own free-text line item. */
    label: z.string().trim().min(1).max(60).optional(),
    incall: z.number().int().positive().optional(),
    outcall: z.number().int().positive().optional(),
  })
  .refine((r) => r.duration !== undefined || r.label !== undefined, {
    message: 'rate row needs a duration or a label',
  })
  .refine((r) => r.incall !== undefined || r.outcall !== undefined, {
    message: 'rate row needs an incall or outcall price',
  });
export type RateRow = z.infer<typeof RateRowSchema>;

/** Minimum price across rate rows (both columns). */
export function ratesMinPrice(rates: readonly RateRow[]): number | undefined {
  const all = rates.flatMap((r) => [r.incall, r.outcall].filter((n): n is number => n !== undefined));
  return all.length ? Math.min(...all) : undefined;
}

/**
 * The card's "from €X": duration rows only — a €5 custom add-on ("phone
 * call") must not masquerade as the meeting price. Falls back to all rows
 * when she only has custom items.
 */
export function priceFromRates(rates: readonly RateRow[]): number | undefined {
  const timed = rates.filter((r) => r.duration !== undefined);
  return ratesMinPrice(timed.length ? timed : rates);
}

export const ProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  /** Lifecycle state — public reads must only ever surface 'live'. */
  state: z.enum(PROFILE_STATES),
  name: z.string(),
  /** Date of birth (YYYY-MM-DD); displayed age is computed via profileAge(). */
  birthDate: z.iso.date(),
  /** Verbatim age text from an import source ("midden twintig") — shown via
   *  profileAgeLabel() instead of the computed number. Never a guessed value. */
  ageDisplay: z.string().optional(),
  gender: z.enum(GENDERS),
  city: z.enum(CITY_SLUGS),
  /** Live but hidden from listings/search/sitemap — direct URL only. */
  unlisted: z.boolean().default(false),
  /** Partner agency (orgs.id) this profile belongs to — /{locale}/agencies/. */
  orgId: z.string().optional(),
  verified: z.boolean(),
  /**
   * Trust-receipt dates (UX-PLAN 3.1) — the public projection of the account's
   * verification state (hard rule 3). ISO datetimes; absent = that check hasn't
   * happened. Optional so an unverified/legacy profile simply omits the line.
   */
  idVerifiedAt: z.iso.datetime().optional(),
  photoVerifiedAt: z.iso.datetime().optional(),
  online: z.boolean(),
  featured: z.boolean(),
  /**
   * DERIVED (UX-PLAN 2.1): the min of the rates table. Input is optional and
   * only used as a fallback for profiles that carry no table yet — the transform
   * below overwrites it whenever `rates` is non-empty, so every reader (search,
   * cards, admin) keeps reading one honest number.
   */
  priceFrom: z.number().int().positive().optional(), // EUR — derived from rates
  /** First-class rate table (UX-PLAN 2.1); `priceFrom` derives from it. */
  rates: z.array(RateRowSchema).default([]),
  /** Public contact number — searchable via `q` (find-someone-specific). */
  phone: z.string().optional(),
  /** Direct external contact handles — rendered as tap-to-contact buttons.
   *  whatsapp = phone digits, telegram/instagram = handles. All optional. */
  whatsapp: z.string().optional(),
  telegram: z.string().optional(),
  instagram: z.string().optional(),
  /** Optional deposit policy shown under the table + in good-to-know. */
  depositPolicy: z.string().optional(),
  /** Optional free note under the table ("extras discussed in person"). */
  extrasNote: z.string().optional(),
  services: z.array(z.enum(SERVICE_VALUES)),
  meetingTypes: z.array(z.enum(MEETING_TYPES)),
  // --- Good-to-know facts (UX-PLAN 2.5): taxonomy keys, labels via i18n. ---
  languages: z.array(z.enum(LANGUAGES)).default([]),
  incallLocations: z.array(z.enum(INCALL_LOCATIONS)).default([]),
  amenities: z.array(z.enum(AMENITIES)).default([]),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).default([]),
  // --- Appearance & physical (taxonomy person attributes). All optional: a
  // sparse profile omits them, and the profile detail + sidebar filters read
  // whatever is set. DB columns are nullable; the import pipeline fills them. ---
  availableFor: z.array(z.enum(AVAILABLE_FOR)).default([]),
  bodyType: z.enum(BODY_TYPES).optional(),
  hairColor: z.enum(HAIR_COLORS).optional(),
  hairLength: z.enum(HAIR_LENGTHS).optional(),
  eyeColor: z.enum(EYE_COLORS).optional(),
  cupSize: z.enum(CUP_SIZES).optional(),
  breastType: z.enum(BREAST_TYPES).optional(),
  pubicHair: z.enum(PUBIC_HAIR).optional(),
  appearance: z.enum(APPEARANCES).optional(),
  /** ISO 3166-1 alpha-2 nationality (free set; COMMON_NATIONALITIES orders the picker). */
  nationality: z.string().length(2).optional(),
  heightCm: z.number().int().min(NUMERIC_RANGES.height_cm.min).max(NUMERIC_RANGES.height_cm.max).optional(),
  weightKg: z.number().int().min(NUMERIC_RANGES.weight_kg.min).max(NUMERIC_RANGES.weight_kg.max).optional(),
  shoeSizeEu: z.number().int().min(NUMERIC_RANGES.shoe_size_eu.min).max(NUMERIC_RANGES.shoe_size_eu.max).optional(),
  smoking: z.enum(SMOKING).optional(),
  drinking: z.enum(DRINKING).optional(),
  tattoos: z.enum(TATTOOS).optional(),
  piercings: z.enum(PIERCINGS).optional(),
  /** Availability per weekday (optional — absent = not specified). */
  openingHours: OpeningHoursSchema.default({}),
  /** Per-date overrides (see DateAvailabilitySchema) — date beats weekday. */
  availabilityDates: AvailabilityDatesSchema.default({}),
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
  /**
   * Her private photo set (UX-PLAN 4.4): shown only inside a thread AFTER she
   * accepts that client's request (per-thread grant, reversed media direction).
   * Public pages only reveal the COUNT ("N more, shared when she accepts your
   * request") — never the images. Optional; empty = no locked set.
   */
  privatePhotos: z.array(z.string()).default([]),
  /** Provenance: the URL she imported her data from (admin-only display). */
  importedFromUrl: z.string().optional(),
  createdAt: z.iso.datetime(),
}).transform((p) => ({
  // priceFrom is derived: the rates table wins; the authored number is only a
  // fallback for tableless profiles. `?? 0` keeps the type a plain number even
  // in the (invalid seed) case of neither — callers never see undefined.
  ...p,
  priceFrom: priceFromRates(p.rates) ?? p.priceFrom ?? 0,
}));
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
  // Feb 29 minus N years is usually not a real date — clamp to the 28th so the
  // derived DOB is always valid (agency crawl fabricates these daily).
  const day = now.getMonth() === 1 && now.getDate() === 29 ? 28 : now.getDate();
  return `${now.getFullYear() - age}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Description in the current locale, falling back to the original text. */
export function localizedDescription(p: Profile, locale: Locale = getLocale() as Locale): string {
  return p.descriptionTranslations[locale] ?? p.description;
}

/** The age as the UI shows it: the source's verbatim text when set ("midden
 *  twintig" — never a guessed number), else the computed years. */
export function profileAgeLabel(p: Pick<Profile, 'ageDisplay' | 'birthDate'>): string {
  return p.ageDisplay || String(profileAge(p.birthDate));
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
function amsParts(d: Date): { day: Day; minutes: number; hhmm: string; iso: string } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday').toLowerCase().slice(0, 3) as Day;
  let hh = get('hour');
  if (hh === '24') hh = '00'; // some engines emit 24:00 for midnight
  const mm = get('minute');
  return {
    day: wd,
    minutes: Number(hh) * 60 + Number(mm),
    hhmm: `${hh}:${mm}`,
    iso: `${get('year')}-${get('month')}-${get('day')}`,
  };
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

/** A date entry as a DayHours row: no times = the whole day. */
const dateAsDayHours = (o: DateAvailability): DayHours => ({
  closed: !o.available,
  allDay: o.available && !o.from && !o.to,
  from: o.from,
  to: o.to,
});

export function availabilityState(p: Profile, now: Date = new Date()): Availability {
  const { day, minutes, iso } = amsParts(now);
  const dayIdx = DOW.indexOf(day);

  // "active today HH:MM" — only when lastActiveAt lands on the same local day.
  let lastActiveToday: string | undefined;
  if (p.lastActiveAt) {
    const la = amsParts(new Date(p.lastActiveAt));
    if (la.day === day) lastActiveToday = la.hhmm;
  }

  if (p.online) return { kind: 'online', lastActiveToday };

  // Precedence: a date entry (agency calendars) beats the weekly row for that
  // day — an explicit AFWEZIG also silences the weekly hours. Weekly = fallback.
  const todayOverride = p.availabilityDates?.[iso];
  const until = openTodayUntil(todayOverride ? dateAsDayHours(todayOverride) : p.openingHours[day], minutes);
  if (until) return { kind: 'today_until', until, lastActiveToday };

  // Not open today → next open day (dates override weekdays here too).
  const base = Date.parse(`${iso}T12:00:00Z`);
  for (let i = 1; i <= 7; i++) {
    const d = DOW[(dayIdx + i) % 7]!;
    const od = p.availabilityDates?.[new Date(base + i * 86_400_000).toISOString().slice(0, 10)];
    if (od) {
      if (od.available) return { kind: 'back_at', nextDay: d, lastActiveToday };
      continue;
    }
    const dh = p.openingHours[d];
    if (dh && !dh.closed && (dh.allDay || toMinutes(dh.to) !== null)) {
      return { kind: 'back_at', nextDay: d, lastActiveToday };
    }
  }
  return { kind: 'back_at', lastActiveToday };
}

/** The next `limit` calendar entries from today (Amsterdam), sorted — feeds the
 *  profile date strip. Past keys are simply ignored (pruning is a re-crawl). */
export interface UpcomingDate {
  date: string;
  day: Day;
  dayOfMonth: number;
  available: boolean;
  from: string;
  to: string;
}
export function upcomingAvailability(p: Profile, now: Date = new Date(), limit = 7): UpcomingDate[] {
  const { iso } = amsParts(now);
  return Object.entries(p.availabilityDates ?? {})
    .filter(([d]) => d >= iso)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([date, v]) => {
      const dt = new Date(`${date}T12:00:00Z`);
      return { date, day: DOW[dt.getUTCDay()]!, dayOfMonth: dt.getUTCDate(), available: v.available, from: v.from, to: v.to };
    });
}

/**
 * Availability sort/filter (this file's ADD): one rank derived from the shared
 * availabilityState helper — online first, then open-today, then back-later.
 * The listing sorts by this BEFORE the chosen sort so available professionals
 * always float to the top; `availableNow` is the "available now" filter.
 */
const AVAILABILITY_RANK: Record<AvailabilityKind, number> = {
  online: 0,
  today_until: 1,
  back_at: 2,
};
export function availabilityRank(p: Profile, now: Date = new Date()): number {
  return AVAILABILITY_RANK[availabilityState(p, now).kind];
}
export function availableNow(p: Profile, now: Date = new Date()): boolean {
  return availabilityRank(p, now) < AVAILABILITY_RANK.back_at;
}

/**
 * Presence → SSR projection (SUPABASE.md §5.4, DATA.md): `online` is DERIVED —
 * a profile is online when its heartbeat (`last_active_at`, written by her
 * island's throttled self-update) is fresher than this window. The json mock
 * carries an explicit flag instead; the db backend derives via this helper.
 */
export const ONLINE_WINDOW_MS = 5 * 60_000;
export function onlineFromLastActive(lastActiveAt: string | undefined, now: Date = new Date()): boolean {
  return !!lastActiveAt && now.getTime() - new Date(lastActiveAt).getTime() < ONLINE_WINDOW_MS;
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
  /** Partner-agency roster (the /{locale}/agencies/{slug} page). */
  orgId: z.string().optional(),
  /** "Available now" filter (this file's ADD): online OR open today. */
  availableNow: z.boolean().default(false),
  featuredOnly: z.boolean().default(false),
  verifiedOnly: z.boolean().default(false),
  /** Default = last online first: the live shelf is the product's promise. */
  sort: z.enum(SORT_OPTIONS).default('recently_online'),
  limit: z.number().int().min(0).max(60).default(PAGE_SIZE),
  offset: z.number().int().min(0).default(0),
});
export type ProfileListParams = z.input<typeof ProfileListParamsSchema>;

export interface ProfileList {
  items: Profile[];
  /** Total matches before limit/offset — pagination + counts come for free. */
  total: number;
}

// ---------------------------------------------------------------------------
// The ONE list semantics (filter → sort → paginate), shared by every backend:
// json passes its parsed rows, the db backend passes projected rows — so the
// two can never drift. ponytail: pure in-memory over the live set; push the
// hot filters into SQL when the live-profile count makes it matter.
// ---------------------------------------------------------------------------

const CITY_NAME = new Map(CITIES.map((c) => [c.slug, c.name.toLowerCase()]));

const SORTERS: Record<string, (a: Profile, b: Profile) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  recently_online: (a, b) =>
    Number(b.online) - Number(a.online) || b.createdAt.localeCompare(a.createdAt),
  price_low_high: (a, b) => a.priceFrom - b.priceFrom,
  price_high_low: (a, b) => b.priceFrom - a.priceFrom,
};

/** Digits only, minus NL prefixes — "+31 6 12…" and "0612…" compare equal. */
const phoneDigits = (s: string) => s.replace(/\D/g, '').replace(/^(0031|31|0)/, '');

/** Naive full-text match (Postgres FTS is a later swap, same semantics seam). */
function matchesQuery(p: Profile, q: string): boolean {
  // Find-someone-specific: a query with 6+ digits is a phone lookup.
  const qDigits = phoneDigits(q);
  if (qDigits.length >= 6) return !!p.phone && phoneDigits(p.phone).includes(qDigits);
  const hay = [p.name, p.description, ...Object.values(p.descriptionTranslations), CITY_NAME.get(p.city) ?? '', ...p.services.map((s) => s.replaceAll('_', ' '))]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/** Filter + sort + paginate a LIVE profile set per validated params. */
export function applyProfileListParams(
  live: readonly Profile[],
  params: ProfileListParams | undefined,
  now: Date = new Date(),
): ProfileList {
  const q = ProfileListParamsSchema.parse(params ?? {});
  const categoryServices = q.serviceCategory ? new Set<string>(SERVICES[q.serviceCategory]) : null;
  // Location = union of the main city (path) and extra sidebar cities.
  const citySet = new Set([...(q.city ? [q.city] : []), ...q.cities]);

  const rows = live
    .filter(
      (p) =>
        (!q.q || matchesQuery(p, q.q)) &&
        (!q.orgId || p.orgId === q.orgId) &&
        (citySet.size === 0 || citySet.has(p.city)) &&
        (q.genders.length === 0 || q.genders.includes(p.gender)) &&
        (q.services.length === 0 || q.services.some((s) => p.services.includes(s))) &&
        (!categoryServices || p.services.some((s) => categoryServices.has(s))) &&
        (!q.meetingType || p.meetingTypes.includes(q.meetingType)) &&
        (q.priceMin === undefined || p.priceFrom >= q.priceMin) &&
        (q.priceMax === undefined || p.priceFrom <= q.priceMax) &&
        (!q.onlineOnly || p.online) &&
        (!q.availableNow || availableNow(p, now)) &&
        (!q.featuredOnly || p.featured) &&
        (!q.verifiedOnly || p.verified),
    )
    .sort(
      // Availability first (online → open-today → back-later), then the chosen
      // sort — available professionals always lead the shelf (UX-PLAN 1.3).
      // Slug last: full ties must order identically on every backend and every
      // request, or offset pagination skips/repeats rows between pages.
      (a, b) =>
        availabilityRank(a, now) - availabilityRank(b, now) ||
        SORTERS[q.sort]!(a, b) ||
        a.slug.localeCompare(b.slug),
    );

  return { items: rows.slice(q.offset, q.offset + q.limit), total: rows.length };
}

/** Contract every backend implements (Drizzle live; json = parity reference). */
export interface ProfilesApi {
  /** PUBLIC read: `live` profiles only (the lifecycle rule, hard rule 6). */
  list(params?: ProfileListParams): Promise<ProfileList>;
  bySlug(slug: string): Promise<Profile | null>;

  // --- admin-capable (ADMIN.md): every state. Guarded by the admin action. ---
  /** Every profile regardless of state — the god-view + moderation queues. */
  listAll(): Promise<Profile[]>;
  byId(id: string): Promise<Profile | null>;
  /** An agency's whole roster, every state — bulk (2 queries), not per-id. */
  byOrg(orgId: string): Promise<Profile[]>;
  /** Lifecycle transition (approve/pause/block/delete). Soft states only. */
  setState(id: string, state: ProfileState): Promise<void>;
  /** Visibility flag (out of search/listings, direct URL still resolves). */
  setUnlisted(id: string, unlisted: boolean): Promise<void>;
}

/**
 * Listing gender filter (radio, not checkbox): the market is ~80% women, so
 * the default is `women`; `trans` fans out to both taxonomy values. UI value →
 * taxonomy `genders` array.
 */
export const GENDER_FILTERS = {
  women: ['female'],
  men: ['male'],
  trans: ['trans_woman', 'trans_man'],
} as const;
export type GenderFilter = keyof typeof GENDER_FILTERS;

/**
 * Parse listing filters from a page URL (GET-form params). Invalid values are
 * dropped, never thrown — a mangled URL is a default listing, not a 500.
 * `defaultGender` (the visitor's last pick, cookie) applies when the URL says
 * nothing; the hard default is `women`.
 */
export function profileListParamsFromUrl(url: URL, defaultGender?: string): ProfileListParams {
  const sp = url.searchParams;
  const opt = (key: string) => sp.get(key) || undefined;
  const num = (key: string) => {
    const n = Number(sp.get(key));
    return Number.isFinite(n) && sp.get(key) !== '' && sp.get(key) !== null ? n : undefined;
  };
  const page = Math.max(1, Math.trunc(num('page') ?? 1));

  const genderPick = [opt('gender'), defaultGender, 'women'].find(
    (g): g is GenderFilter => !!g && g in GENDER_FILTERS,
  )!;

  const candidate = {
    q: opt('q'),
    city: opt('city'),
    cities: sp.getAll('cities'),
    genders: [...GENDER_FILTERS[genderPick]],
    services: sp.getAll('services'),
    meetingType: opt('visit'),
    priceMin: num('priceMin'),
    priceMax: num('priceMax'),
    onlineOnly: sp.has('online'),
    availableNow: sp.has('available'),
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
