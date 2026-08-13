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
import { eq, inArray } from 'drizzle-orm';
import { requestDb, requestMemo, type Db } from '@/db/client';
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
 * media.image_key → served URL. R2-stored keys (`pub/…`, `priv/…`) route
 * through /media (edge-cached, gated); seed/static keys (absolute path or full
 * URL) pass through unchanged.
 */
export const mediaUrl = (key: string): string =>
  key.startsWith('/') || key.startsWith('http') ? key : `/media/${key}`;

/**
 * media row → gallery entry. Public reads see `approved` only; the owner
 * dashboard passes `allStates` so she can see her pending uploads too.
 */
export function toProfile(
  row: ProfileRow,
  mediaRows: MediaRow[],
  now: Date,
  opts: { allStates?: boolean } = {},
): Profile {
  const gallery = mediaRows
    .filter((m) => m.profileId === row.id && (opts.allStates || m.state === 'approved'))
    .sort((a, b) => a.position - b.position);
  return ProfileSchema.parse({
    id: row.id,
    slug: row.slug,
    state: row.state,
    name: row.name,
    birthDate: row.birthDate,
    gender: row.gender,
    city: row.city,
    unlisted: row.unlisted,
    orgId: row.orgId ?? undefined,
    verified: row.verified,
    idVerifiedAt: iso(row.idVerifiedAt),
    photoVerifiedAt: iso(row.photoVerifiedAt),
    online: onlineFromLastActive(iso(row.lastActiveAt), now),
    featured: row.featured,
    priceFrom: row.priceFrom ?? undefined,
    rates: row.rates,
    phone: row.phone ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    telegram: row.telegram ?? undefined,
    instagram: row.instagram ?? undefined,
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
    availabilityDates: row.availabilityDates,
    lastActiveAt: iso(row.lastActiveAt),
    description: row.description,
    descriptionTranslations: row.descriptionTranslations,
    photos: gallery.filter((m) => !m.isPrivate).map((m) => mediaUrl(m.imageKey)),
    privatePhotos: gallery.filter((m) => m.isPrivate).map((m) => mediaUrl(m.imageKey)),
    importedFromUrl: row.importedFromUrl ?? undefined,
    createdAt: iso(row.createdAt),
  });
}

/** Request-memoized: the promise is cached, so the home page's three
 *  concurrent list() calls share ONE catalog fetch (2 queries instead of 6).
 *  requestMemo() is undefined outside a request → tests/scripts stay uncached. */
function liveProfiles(db: Db, now: Date, slug?: string, city?: string, orgId?: string): Promise<Profile[]> {
  const memo = requestMemo();
  const key = `live-profiles:${slug ?? ''}|${city ?? ''}|${orgId ?? ''}`;
  const hit = memo?.get(key) as Promise<Profile[]> | undefined;
  if (hit) return hit;
  const fresh = fetchLiveProfiles(db, now, slug, city, orgId);
  memo?.set(key, fresh);
  return fresh;
}

async function fetchLiveProfiles(db: Db, now: Date, slug?: string, city?: string, orgId?: string): Promise<Profile[]> {
  const rows = await db.query.profiles
    .findMany({
      where: (p, { and, eq }) =>
        and(
          eq(p.state, 'live'),
          // Unlisted: excluded from every listing, reachable by direct slug.
          slug === undefined ? eq(p.unlisted, false) : eq(p.slug, slug),
          city === undefined ? undefined : eq(p.city, city as (typeof p.city)['_']['data']),
          // Agency pages: don't drag the whole catalog for one roster.
          orgId === undefined ? undefined : eq(p.orgId, orgId),
        ),
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

/** Every profile, any state (admin surfaces) — with all media states. */
async function allProfiles(db: Db, now: Date, filter: { id?: string; orgId?: string } = {}): Promise<Profile[]> {
  const rows = await db.query.profiles.findMany({
    where: (p, { eq }) =>
      filter.id !== undefined ? eq(p.id, filter.id) : filter.orgId !== undefined ? eq(p.orgId, filter.orgId) : undefined,
  });
  if (rows.length === 0) return [];
  const mediaRows = await db
    .select()
    .from(media)
    .where(inArray(media.profileId, rows.map((r) => r.id)));
  return rows.map((r) => toProfile(r, mediaRows, now, { allStates: true }));
}

/** Backend over any Db — tests construct one directly. */
export function makeProfilesApi(db: Db): ProfilesApi {
  return {
    async list(params = {}) {
      const now = new Date();
      // City pushdown: city hubs + the similar-profiles fetch on every profile
      // page shouldn't drag the whole live catalog over the wire. Only a
      // sidebar cities-union needs the full set (applyProfileListParams then
      // filters identically either way — same results as the json backend).
      const cityPush = params.cities?.length ? undefined : params.city;
      return applyProfileListParams(await liveProfiles(db, now, undefined, cityPush, params.orgId), params, now);
    },
    async bySlug(slug) {
      return (await liveProfiles(db, new Date(), slug))[0] ?? null;
    },
    async listAll() {
      return allProfiles(db, new Date());
    },
    async byId(id) {
      return (await allProfiles(db, new Date(), { id }))[0] ?? null;
    },
    async byOrg(orgId) {
      return allProfiles(db, new Date(), { orgId });
    },
    async setState(id, state) {
      // state_changed_at is stamped by the DB trigger (0001_security).
      await db.update(profiles).set({ state }).where(eq(profiles.id, id));
    },
    async setUnlisted(id, unlisted) {
      await db.update(profiles).set({ unlisted }).where(eq(profiles.id, id));
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
  const api = () => makeProfilesApi(requestDb(binding()));
  return {
    list: (p) => api().list(p),
    bySlug: (s) => api().bySlug(s),
    listAll: () => api().listAll(),
    byId: (id) => api().byId(id),
    byOrg: (orgId) => api().byOrg(orgId),
    setState: (id, state) => api().setState(id, state),
    setUnlisted: (id, unlisted) => api().setUnlisted(id, unlisted),
  };
}
