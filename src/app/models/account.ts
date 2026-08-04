/**
 * Account domain model: the `accounts` row (verification state + identity) plus
 * the advertiser's own profile/media operations (docs/API.md seam; DATA.md).
 *
 * The mock's editor-delta layer is GONE (decided 2026-08-03): edits write the
 * profiles row directly and publish immediately — no profileOverride, no
 * extraPhotos/removedPhotos. Photos are `media` rows; human moderation is
 * images-only (ADMIN.md §6).
 */
import { z } from 'zod';
import { ALL_SERVICES, AMENITIES, APPEARANCES, AVAILABLE_FOR, BODY_TYPES, BREAST_TYPES, CITIES, CUP_SIZES, DRINKING, EYE_COLORS, GENDERS, HAIR_COLORS, HAIR_LENGTHS, INCALL_LOCATIONS, LANGUAGES, MEDIA_STATES, MEETING_TYPES, NUMERIC_RANGES, PAYMENT_METHODS, PIERCINGS, POLICY_MIN_AGE, PUBIC_HAIR, SMOKING, TATTOOS, VERIFICATION_STATES, type AccountType, type AdminRole, type CitySlug, type Service } from '@/lib/taxonomy';
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

/** The `accounts` row as the app consumes it (favorites joined in). */
export const AccountSchema = z.object({
  phone: z.string().optional(),
  phoneVerifiedAt: z.iso.datetime().optional(),
  idVerification: z.enum(VERIFICATION_STATES).default('unverified'),
  /** When the advertiser submitted ID for review (drives the admin queue order). */
  verificationSubmittedAt: z.iso.datetime().optional(),
  // NOTE: photo verification is a PROFILE trust-receipt (`profiles.photo_verified_at`,
  // read via profile.photoVerifiedAt) — never an account field.
  /** Admin's rejection reason (taxonomy) — shown to the advertiser verbatim (ADMIN.md §5). */
  verificationReason: z.string().optional(),
  /** Favorited profile slugs (the `favorites` table, projected). */
  favorites: z.array(z.string()).default([]),
});
export type Account = z.infer<typeof AccountSchema>;

/**
 * An account plus its identity — the shape admin lookups return. `accountType`
 * is the REAL role column (the mock inferred it from the email local-part).
 */
export interface AccountRecord extends Account {
  email: string;
  accountType: AccountType;
  /** Admin sub-role (present only for admin accounts). */
  adminRole?: AdminRole;
  displayName: string;
  /** Her profile slug, when she has one (advertisers). */
  profileSlug?: string;
}

/** One `media` row as the dashboard renders it. */
export interface MediaItem {
  id: string;
  /** Served URL (Cloudflare Images later; see data/db/account.ts mediaUrl). */
  url: string;
  isPrivate: boolean;
  state: (typeof MEDIA_STATES)[number];
}

export interface AccountApi {
  get(session: Session): Promise<Account>;
  save(session: Session, patch: Partial<Account>): Promise<Account>;
  /** Her profile row (any state — this is the owner view), or null if none yet. */
  myProfile(session: Session): Promise<Profile | null>;
  /**
   * Write her profile columns. Creates the row on first save (state `draft`);
   * edits to a live profile publish immediately (ADMIN.md §6).
   */
  saveProfile(session: Session, patch: Partial<ProfileEdit>): Promise<void>;
  /** Submit a draft/paused profile for review → `pending_review`. */
  submitProfile(session: Session): Promise<void>;
  /** Owner pause/unpause: hides a live profile (`paused`) and brings it back (`live`). */
  setPaused(session: Session, paused: boolean): Promise<void>;
  /**
   * Store EXIF-stripped ID documents in the private EU bucket + record a hash per
   * doc, then flag the account `pending` review (hard rule 3). Contents never
   * logged; reads are admin-only + audit-logged (separate surface).
   */
  submitVerification(session: Session, input: { docs: { bytes: ArrayBuffer }[] }): Promise<void>;

  // --- media (her gallery) — bytes go to R2, the row records the key ---
  photos(session: Session): Promise<MediaItem[]>;
  addPhoto(session: Session, input: { bytes: ArrayBuffer; contentType: string; isPrivate?: boolean }): Promise<void>;
  removePhoto(session: Session, input: { id: string }): Promise<void>;

  // --- admin-capable access (ADMIN.md): by email, not session. ---
  all(): Promise<AccountRecord[]>;
  byEmail(email: string): Promise<AccountRecord | null>;
  saveByEmail(email: string, patch: Partial<Account>): Promise<Account>;
}
