/**
 * Account domain model: verification state + the advertiser's own edits on
 * top of her public profile (docs/API.md seam; ARCHITECTURE §11 shapes the
 * verification fields).
 */
import { z } from 'zod';
import { ALL_SERVICES, AMENITIES, APPEARANCES, AVAILABLE_FOR, BODY_TYPES, BREAST_TYPES, CITIES, CUP_SIZES, DRINKING, EYE_COLORS, GENDERS, HAIR_COLORS, HAIR_LENGTHS, INCALL_LOCATIONS, LANGUAGES, MEETING_TYPES, NUMERIC_RANGES, PAYMENT_METHODS, PIERCINGS, POLICY_MIN_AGE, PUBIC_HAIR, SMOKING, TATTOOS, VERIFICATION_STATES, type CitySlug, type Service } from '@/lib/taxonomy';
import { OpeningHoursSchema, RateRowSchema, profileAge, type Profile } from '@/app/models/profile';
import type { Session } from '@/app/models/session';

const CITY_SLUGS = CITIES.map((c) => c.slug) as unknown as [CitySlug, ...CitySlug[]];
const SERVICE_VALUES = ALL_SERVICES as unknown as [Service, ...Service[]];

/** The fields an advertiser may edit herself (taxonomy-constrained). */
export const ProfileEditSchema = z.object({
  name: z.string().trim().min(2).max(40),
  // Policy age gate (ARCHITECTURE §8.4): 21+ (POLICY_MIN_AGE). DB CHECK backs it.
  birthDate: z.iso.date().refine((d) => profileAge(d) >= POLICY_MIN_AGE, {
    message: `must be at least ${POLICY_MIN_AGE}`,
  }),
  gender: z.enum(GENDERS),
  city: z.enum(CITY_SLUGS),
  // priceFrom is derived from `rates` (UX-PLAN 2.1) — not directly editable.
  rates: z.array(RateRowSchema).max(24), // presets + her custom line items
  depositPolicy: z.string().trim().max(200).optional(),
  extrasNote: z.string().trim().max(200).optional(),
  services: z.array(z.enum(SERVICE_VALUES)).max(20),
  meetingTypes: z.array(z.enum(MEETING_TYPES)).min(1),
  languages: z.array(z.enum(LANGUAGES)).max(12),
  incallLocations: z.array(z.enum(INCALL_LOCATIONS)),
  amenities: z.array(z.enum(AMENITIES)),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)),
  // Appearance & physical (taxonomy person attributes) — all optional.
  availableFor: z.array(z.enum(AVAILABLE_FOR)),
  bodyType: z.enum(BODY_TYPES).optional(),
  hairColor: z.enum(HAIR_COLORS).optional(),
  hairLength: z.enum(HAIR_LENGTHS).optional(),
  eyeColor: z.enum(EYE_COLORS).optional(),
  cupSize: z.enum(CUP_SIZES).optional(),
  breastType: z.enum(BREAST_TYPES).optional(),
  pubicHair: z.enum(PUBIC_HAIR).optional(),
  appearance: z.enum(APPEARANCES).optional(),
  nationality: z.string().length(2).optional(),
  heightCm: z.number().int().min(NUMERIC_RANGES.height_cm.min).max(NUMERIC_RANGES.height_cm.max).optional(),
  weightKg: z.number().int().min(NUMERIC_RANGES.weight_kg.min).max(NUMERIC_RANGES.weight_kg.max).optional(),
  shoeSizeEu: z.number().int().min(NUMERIC_RANGES.shoe_size_eu.min).max(NUMERIC_RANGES.shoe_size_eu.max).optional(),
  smoking: z.enum(SMOKING).optional(),
  drinking: z.enum(DRINKING).optional(),
  tattoos: z.enum(TATTOOS).optional(),
  piercings: z.enum(PIERCINGS).optional(),
  openingHours: OpeningHoursSchema,
  description: z.string().trim().max(1000),
});
export type ProfileEdit = z.infer<typeof ProfileEditSchema>;

export const AccountSchema = z.object({
  phone: z.string().optional(),
  phoneVerifiedAt: z.iso.datetime().optional(),
  idVerification: z.enum(VERIFICATION_STATES).default('unverified'),
  /** When the advertiser submitted ID for review (drives the admin queue order). */
  verificationSubmittedAt: z.iso.datetime().optional(),
  /** When her photos passed verification (UX-PLAN 3.1) — a dated trust-receipt fact. */
  photoVerifiedAt: z.iso.datetime().optional(),
  /** Admin's rejection reason (taxonomy) — shown to the advertiser verbatim (ADMIN.md §5). */
  verificationReason: z.string().optional(),
  profileOverride: ProfileEditSchema.partial().default({}),
  /** Small re-encoded JPEG data-URLs added via the media manager (mock store). */
  extraPhotos: z.array(z.string()).default([]),
  /** Indexes into the base profile's photos that were removed. */
  removedPhotos: z.array(z.number().int().min(0)).default([]),
  /** Favorited profile slugs synced from the device on login/register. */
  favorites: z.array(z.string()).default([]),
});
export type Account = z.infer<typeof AccountSchema>;

/** An account plus its owning email — the shape admin lookups return. */
export interface AccountRecord extends Account {
  email: string;
}

export interface AccountApi {
  get(session: Session): Promise<Account>;
  save(session: Session, patch: Partial<Account>): Promise<Account>;
  /** The advertiser's profile with her edits + photo changes merged in. */
  myProfile(session: Session): Promise<Profile | null>;

  // --- admin-capable access (ADMIN.md): by email, not session. In prod these
  // are RLS-gated to the service role; the admin action checks the role first.
  all(): Promise<AccountRecord[]>;
  byEmail(email: string): Promise<AccountRecord | null>;
  saveByEmail(email: string, patch: Partial<Account>): Promise<Account>;
}
