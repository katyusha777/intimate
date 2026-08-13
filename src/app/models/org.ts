/**
 * Org (partner agency) model bits — the validated JSONB payloads shared by the
 * Drizzle schema, the admin actions and the public seam (@/app/api/orgs). The
 * org row itself stays a Drizzle shape; only structured columns live here.
 */
import { z } from 'zod';
import { CITY_SLUGS } from '@/lib/taxonomy';
import { OpeningHoursSchema } from './profile';

/**
 * One physical branch of a multi-location agency (kimnl: Tilburg + Rotterdam,
 * each with its own address, phones and opening hours). A profile's branch is
 * resolved by matching `profiles.city` against `city` here.
 * ponytail: city match breaks with two branches in one city — add an explicit
 * per-profile location index when that agency shows up.
 */
/** The org's PUBLIC projection (agency page, profile AgencyCard) — private
 *  business data (contact email, KvK, crawl config) is deliberately absent.
 *  Produced by @/app/api/orgs; typed here so components never import the seam. */
export interface PublicAgency {
  id: string;
  name: string;
  slug: string;
  city: string;
  verified: boolean;
  description: string;
  logoUrl?: string;
  siteUrl?: string;
  /** Physical branches (address/phones/hours) — public storefront data. */
  locations: OrgLocation[];
  createdAt: string;
}

export const OrgLocationSchema = z.object({
  city: z.enum(CITY_SLUGS),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  whatsapp: z.string().trim().max(30).optional(),
  openingHours: OpeningHoursSchema.default({}),
});
export type OrgLocation = z.infer<typeof OrgLocationSchema>;
export const OrgLocationsSchema = z.array(OrgLocationSchema).max(10);
