/**
 * Account domain model: verification state + the advertiser's own edits on
 * top of her public profile (docs/API.md seam; ARCHITECTURE §11 shapes the
 * verification fields).
 */
import { z } from 'zod';
import { CITIES, GENDERS, MEETING_TYPES, ALL_SERVICES, VERIFICATION_STATES, type CitySlug, type Service } from '@/lib/taxonomy';
import { OpeningHoursSchema, type Profile } from '@/app/models/profile';
import type { Session } from '@/app/models/session';

const CITY_SLUGS = CITIES.map((c) => c.slug) as unknown as [CitySlug, ...CitySlug[]];
const SERVICE_VALUES = ALL_SERVICES as unknown as [Service, ...Service[]];

/** The fields an advertiser may edit herself (taxonomy-constrained). */
export const ProfileEditSchema = z.object({
  name: z.string().trim().min(2).max(40),
  birthDate: z.iso.date(), // 18+ enforced at the input + server (ARCHITECTURE §8.4)
  gender: z.enum(GENDERS),
  city: z.enum(CITY_SLUGS),
  priceFrom: z.number().int().min(0).max(10_000),
  services: z.array(z.enum(SERVICE_VALUES)).max(20),
  meetingTypes: z.array(z.enum(MEETING_TYPES)).min(1),
  openingHours: OpeningHoursSchema,
  description: z.string().trim().max(1000),
});
export type ProfileEdit = z.infer<typeof ProfileEditSchema>;

export const AccountSchema = z.object({
  phone: z.string().optional(),
  phoneVerifiedAt: z.string().optional(),
  idVerification: z.enum(VERIFICATION_STATES).default('unverified'),
  profileOverride: ProfileEditSchema.partial().default({}),
  /** Small re-encoded JPEG data-URLs added via the media manager (mock store). */
  extraPhotos: z.array(z.string()).default([]),
  /** Indexes into the base profile's photos that were removed. */
  removedPhotos: z.array(z.number().int().min(0)).default([]),
  /** Favorited profile slugs synced from the device on login/register. */
  favorites: z.array(z.string()).default([]),
});
export type Account = z.infer<typeof AccountSchema>;

export interface AccountApi {
  get(session: Session): Promise<Account>;
  save(session: Session, patch: Partial<Account>): Promise<Account>;
  /** The advertiser's profile with her edits + photo changes merged in. */
  myProfile(session: Session): Promise<Profile | null>;
}
