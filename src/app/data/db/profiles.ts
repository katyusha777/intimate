/**
 * Drizzle backend for profiles (docs/DATA.md §5): rows → Zod Profile, then the
 * SAME applyProfileListParams as the json backend — semantics can't drift.
 *
 * Projections this backend owns:
 *  - photos/privatePhotos: approved `media` rows (position order) → key/URL
 *  - online: derived from the last_active_at heartbeat (ONLINE_WINDOW_MS)
 *  - priceFrom: the stored column feeds the schema, which re-derives from rates
 *
 * ponytail: loads all live rows then filters in JS (shared core) — push city/
 * gender/services into SQL when the live-profile count makes it matter.
 */
import { inArray } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';
import { media, profiles } from '@/db/schema';
import {
  applyProfileListParams,
  onlineFromLastActive,
  ProfileSchema,
  type Profile,
  type ProfilesApi,
} from '@/app/models/profile';

type ProfileRow = typeof profiles.$inferSelect;
type MediaRow = typeof media.$inferSelect;

const iso = (v: Date | string | null): string | undefined =>
  v == null ? undefined : (v instanceof Date ? v : new Date(v)).toISOString();

/**
 * media.image_key → served URL. Cloudflare Images delivery lands with the
 * upload flow (Phase D); dev-seeded keys are full URLs and pass through.
 */
const mediaUrl = (key: string): string => key;

function toProfile(row: ProfileRow, mediaRows: MediaRow[], now: Date): Profile {
  const gallery = mediaRows
    .filter((m) => m.profileId === row.id && m.state === 'approved')
    .sort((a, b) => a.position - b.position);
  return ProfileSchema.parse({
    id: row.id,
    slug: row.slug,
    state: row.state,
    name: row.name,
    birthDate: row.birthDate,
    gender: row.gender,
    city: row.city,
    verified: row.verified,
    idVerifiedAt: iso(row.idVerifiedAt),
    photoVerifiedAt: iso(row.photoVerifiedAt),
    online: onlineFromLastActive(iso(row.lastActiveAt), now),
    featured: row.featured,
    priceFrom: row.priceFrom ?? undefined,
    rates: row.rates,
    phone: row.phone ?? undefined,
    depositPolicy: row.depositPolicy ?? undefined,
    extrasNote: row.extrasNote ?? undefined,
    services: row.services,
    meetingTypes: row.meetingTypes,
    languages: row.languages,
    incallLocations: row.incallLocations,
    amenities: row.amenities,
    paymentMethods: row.paymentMethods,
    availableFor: row.availableFor,
    bodyType: row.bodyType ?? undefined,
    hairColor: row.hairColor ?? undefined,
    hairLength: row.hairLength ?? undefined,
    eyeColor: row.eyeColor ?? undefined,
    cupSize: row.cupSize ?? undefined,
    breastType: row.breastType ?? undefined,
    pubicHair: row.pubicHair ?? undefined,
    appearance: row.appearance ?? undefined,
    nationality: row.nationality ?? undefined,
    heightCm: row.heightCm ?? undefined,
    weightKg: row.weightKg ?? undefined,
    shoeSizeEu: row.shoeSizeEu ?? undefined,
    smoking: row.smoking ?? undefined,
    drinking: row.drinking ?? undefined,
    tattoos: row.tattoos ?? undefined,
    piercings: row.piercings ?? undefined,
    openingHours: row.openingHours,
    lastActiveAt: iso(row.lastActiveAt),
    description: row.description,
    descriptionTranslations: row.descriptionTranslations,
    photos: gallery.filter((m) => !m.isPrivate).map((m) => mediaUrl(m.imageKey)),
    privatePhotos: gallery.filter((m) => m.isPrivate).map((m) => mediaUrl(m.imageKey)),
    createdAt: iso(row.createdAt),
  });
}

async function liveProfiles(db: Db, now: Date, slug?: string): Promise<Profile[]> {
  const rows = await db.query.profiles
    .findMany({
      where: (p, { and, eq }) =>
        slug === undefined ? eq(p.state, 'live') : and(eq(p.state, 'live'), eq(p.slug, slug)),
    })
    .catch((e: unknown) => {
      // Surface the driver error — drizzle's wrapper hides the real cause.
      console.error('[db/profiles] query failed:', (e as Error & { cause?: unknown }).cause ?? e);
      throw e;
    });
  if (rows.length === 0) return [];
  const mediaRows = await db
    .select()
    .from(media)
    .where(inArray(media.profileId, rows.map((r) => r.id)));
  return rows.map((r) => toProfile(r, mediaRows, now));
}

/** Backend over any Db — tests construct one against local Postgres. */
export function makeProfilesApi(db: Db): ProfilesApi {
  return {
    async list(params = {}) {
      const now = new Date();
      return applyProfileListParams(await liveProfiles(db, now), params, now);
    },
    async bySlug(slug) {
      return (await liveProfiles(db, new Date(), slug))[0] ?? null;
    },
  };
}

/**
 * Workerd wiring for the seam (api/profiles.ts provides the binding —
 * cloudflare:workers stays OUT of this module so tests can import it).
 * A FRESH client per call: workerd forbids sharing I/O objects (sockets)
 * across requests ("Cannot perform I/O on behalf of a different request");
 * Hyperdrive exists precisely to make per-request connects cheap.
 * ponytail: no explicit sql.end() — sockets die with the request context;
 * thread ctx.waitUntil through if socket lingering ever measures as a problem.
 */
export function profilesDbApi(binding: () => Pick<Hyperdrive, 'connectionString'>): ProfilesApi {
  const api = () => makeProfilesApi(createDb(binding()));
  return {
    list: (p) => api().list(p),
    bySlug: (s) => api().bySlug(s),
  };
}
