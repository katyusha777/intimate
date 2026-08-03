/**
 * Drizzle backend for accounts + the advertiser's own profile/media (DATA.md).
 * Replaces the KV mock: verification state lives on the `accounts` row,
 * favorites in the `favorites` table, photos in `media`, and profile edits
 * write `profiles` columns directly (publish-immediately, ADMIN.md §6).
 *
 * Fresh Db per call — workerd forbids reusing I/O across requests.
 */
import { env } from 'cloudflare:workers';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';
import { accounts, favorites, media, profiles } from '@/db/schema';
import {
  AccountSchema,
  ProfileEditSchema,
  type Account,
  type AccountApi,
  type AccountRecord,
  type MediaItem,
  type ProfileEdit,
} from '@/app/models/account';
import { ProfileSchema, birthDateForAge, priceFromRates, type Profile } from '@/app/models/profile';
import { mediaUrl, toProfile } from '@/app/data/db/profiles';
import { CITIES, POLICY_MIN_AGE } from '@/lib/taxonomy';
import type { Session } from '@/app/models/session';

const db = (): Db => createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

type AccountRow = typeof accounts.$inferSelect;

const iso = (v: Date | null): string | undefined => v?.toISOString();

/** accounts row + favorite slugs → the Account the app consumes. */
function toAccount(row: AccountRow, favSlugs: string[]): Account {
  return AccountSchema.parse({
    phone: row.phone ?? undefined,
    phoneVerifiedAt: iso(row.phoneVerifiedAt),
    idVerification: row.idVerification,
    verificationSubmittedAt: iso(row.verificationSubmittedAt),
    verificationReason: row.verificationReason ?? undefined,
    favorites: favSlugs,
  });
}

/**
 * An unsaved starter profile for an advertiser who has no row yet — the editor
 * needs an object to bind to. Empty `id`/`slug` mark it as not-yet-persisted.
 */
function blankProfile(session: Session): Profile {
  const now = new Date();
  return ProfileSchema.parse({
    id: '',
    slug: '',
    state: 'draft',
    name: session.name,
    birthDate: birthDateForAge(POLICY_MIN_AGE, now), // she corrects it; DB CHECKs it
    gender: 'female',
    city: CITIES[0].slug,
    verified: false,
    online: false,
    featured: false,
    rates: [],
    services: [],
    meetingTypes: [],
    description: '',
    photos: [],
    createdAt: now.toISOString(),
  });
}

/** The admin-facing record: account + real identity (no email heuristics). */
function record(row: AccountRow, favSlugList: string[], profileSlug?: string): AccountRecord {
  return {
    email: row.email ?? row.id,
    accountType: row.accountType,
    displayName: row.displayName ?? (row.email ?? '').split('@')[0] ?? 'User',
    profileSlug,
    ...toAccount(row, favSlugList),
  };
}

/** Account columns from a patch — undefined keys are left untouched. */
function accountUpdate(patch: Partial<Account>) {
  const u: Partial<typeof accounts.$inferInsert> = {};
  if (patch.phone !== undefined) u.phone = patch.phone;
  if (patch.phoneVerifiedAt !== undefined) u.phoneVerifiedAt = new Date(patch.phoneVerifiedAt);
  if (patch.idVerification !== undefined) u.idVerification = patch.idVerification;
  if (patch.verificationSubmittedAt !== undefined)
    u.verificationSubmittedAt = new Date(patch.verificationSubmittedAt);
  if (patch.verificationReason !== undefined) u.verificationReason = patch.verificationReason;
  return u;
}

async function favSlugs(d: Db, accountId: string): Promise<string[]> {
  const rows = await d
    .select({ slug: profiles.slug })
    .from(favorites)
    .innerJoin(profiles, eq(profiles.id, favorites.profileId))
    .where(eq(favorites.clientAccountId, accountId));
  return rows.map((r) => r.slug);
}

/** Replace the favorites set (slugs → rows); unknown slugs are dropped. */
async function setFavorites(d: Db, accountId: string, slugs: string[]): Promise<void> {
  const wanted = slugs.length
    ? await d.select({ id: profiles.id }).from(profiles).where(inArray(profiles.slug, slugs))
    : [];
  await d.delete(favorites).where(eq(favorites.clientAccountId, accountId));
  if (wanted.length) {
    await d
      .insert(favorites)
      .values(wanted.map((p) => ({ clientAccountId: accountId, profileId: p.id })))
      .onConflictDoNothing();
  }
}

async function accountById(d: Db, id: string): Promise<AccountRow | undefined> {
  return (await d.select().from(accounts).where(eq(accounts.id, id)).limit(1))[0];
}

async function myProfileRow(d: Db, accountId: string) {
  return (
    await d.select().from(profiles).where(eq(profiles.accountId, accountId)).limit(1)
  )[0];
}

/** `Eva` + `amsterdam` → `eva-amsterdam`, deduped against existing slugs. */
async function uniqueSlug(d: Db, name: string, city: string): Promise<string> {
  const base =
    `${name}-${city}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'profile';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await d.select({ id: profiles.id }).from(profiles).where(eq(profiles.slug, candidate)).limit(1);
    if (!hit.length) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** ProfileEdit patch → profiles columns (only the keys present). */
function profileUpdate(patch: Partial<ProfileEdit>) {
  const u: Record<string, unknown> = {};
  const copy = [
    'name', 'gender', 'city', 'rates', 'depositPolicy', 'extrasNote', 'services',
    'meetingTypes', 'languages', 'incallLocations', 'amenities', 'paymentMethods',
    'availableFor', 'bodyType', 'hairColor', 'hairLength', 'eyeColor', 'cupSize',
    'breastType', 'pubicHair', 'appearance', 'nationality', 'heightCm', 'weightKg',
    'shoeSizeEu', 'smoking', 'drinking', 'tattoos', 'piercings', 'openingHours',
    'description',
  ] as const;
  for (const k of copy) if (patch[k] !== undefined) u[k] = patch[k];
  if (patch.birthDate !== undefined) u.birthDate = patch.birthDate;
  // priceFrom is DERIVED (UX-PLAN 2.1) — recompute whenever rates change.
  if (patch.rates !== undefined) u.priceFrom = priceFromRates(patch.rates) ?? null;
  return u;
}

export const accountApi: AccountApi = {
  async get(session) {
    const d = db();
    const row = await accountById(d, session.accountId);
    if (!row) return AccountSchema.parse({});
    return toAccount(row, await favSlugs(d, session.accountId));
  },

  async save(session, patch) {
    const d = db();
    const update = accountUpdate(patch);
    if (Object.keys(update).length) {
      await d.update(accounts).set(update).where(eq(accounts.id, session.accountId));
    }
    if (patch.favorites !== undefined) await setFavorites(d, session.accountId, patch.favorites);
    const row = await accountById(d, session.accountId);
    return row ? toAccount(row, await favSlugs(d, session.accountId)) : AccountSchema.parse({});
  },

  async myProfile(session) {
    const d = db();
    const row = await myProfileRow(d, session.accountId);
    // No row yet: hand the editor an UNSAVED draft so she has something to
    // fill in — the first saveProfile persists it (id/slug stay empty until
    // then, which is how callers tell a draft from a real row).
    if (!row) return session.role === 'advertiser' ? blankProfile(session) : null;
    const mediaRows = await d.select().from(media).where(eq(media.profileId, row.id));
    // Owner view: every state, including photos still in review.
    return toProfile(row, mediaRows, new Date(), { allStates: true });
  },

  async saveProfile(session, patch) {
    const d = db();
    const existing = await myProfileRow(d, session.accountId);
    if (existing) {
      const update = profileUpdate(patch);
      if (Object.keys(update).length) {
        await d.update(profiles).set(update).where(eq(profiles.id, existing.id));
      }
      return;
    }
    // First save creates the row — the identity fields are mandatory then.
    const seed = ProfileEditSchema.pick({ name: true, birthDate: true, gender: true, city: true }).parse(patch);
    await d.insert(profiles).values({
      accountId: session.accountId,
      slug: await uniqueSlug(d, seed.name, seed.city),
      state: 'draft',
      ...(profileUpdate(patch) as { name: string }),
      name: seed.name,
      birthDate: seed.birthDate,
      gender: seed.gender,
      city: seed.city,
    });
  },

  async submitProfile(session) {
    const d = db();
    // Never auto-publish (hard rule 5): live profiles stay live (edits publish
    // immediately), everything else enters the moderation queue.
    await d
      .update(profiles)
      .set({ state: 'pending_review' })
      .where(and(eq(profiles.accountId, session.accountId), inArray(profiles.state, ['draft', 'paused'])));
  },

  async photos(session) {
    const d = db();
    const row = await myProfileRow(d, session.accountId);
    if (!row) return [];
    const rows = await d
      .select()
      .from(media)
      .where(eq(media.profileId, row.id))
      .orderBy(media.position);
    return rows.map(
      (m): MediaItem => ({ id: m.id, url: mediaUrl(m.imageKey), isPrivate: m.isPrivate, state: m.state }),
    );
  },

  async addPhoto(session, { imageKey, isPrivate = false }) {
    const d = db();
    const row = await myProfileRow(d, session.accountId);
    if (!row) return;
    const [agg] = await d
      .select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${media.position}), -1) + 1` })
      .from(media)
      .where(eq(media.profileId, row.id));
    if ((agg?.n ?? 0) >= 20) return; // cap: a gallery, not a dump
    await d.insert(media).values({
      profileId: row.id,
      imageKey,
      isPrivate,
      position: agg?.next ?? 0,
      state: 'pending_review', // images are the one human-moderated surface
    });
  },

  async removePhoto(session, { id }) {
    const d = db();
    const row = await myProfileRow(d, session.accountId);
    if (!row) return;
    // Scoped to HER profile — an id from another gallery deletes nothing.
    await d.delete(media).where(and(eq(media.id, id), eq(media.profileId, row.id)));
  },

  async all() {
    const d = db();
    const rows = await d.select().from(accounts);
    const favRows = await d
      .select({ accountId: favorites.clientAccountId, slug: profiles.slug })
      .from(favorites)
      .innerJoin(profiles, eq(profiles.id, favorites.profileId));
    const owned = await d.select({ accountId: profiles.accountId, slug: profiles.slug }).from(profiles);
    const byAccount = new Map<string, string[]>();
    for (const f of favRows) byAccount.set(f.accountId, [...(byAccount.get(f.accountId) ?? []), f.slug]);
    const slugOf = new Map(owned.map((p) => [p.accountId, p.slug]));
    return rows.map((r): AccountRecord => record(r, byAccount.get(r.id) ?? [], slugOf.get(r.id)));
  },

  async byEmail(email) {
    const d = db();
    const [row] = await d.select().from(accounts).where(eq(accounts.email, email.toLowerCase())).limit(1);
    if (!row) return null;
    const [owned] = await d
      .select({ slug: profiles.slug })
      .from(profiles)
      .where(eq(profiles.accountId, row.id))
      .limit(1);
    return record(row, await favSlugs(d, row.id), owned?.slug);
  },

  async saveByEmail(email, patch) {
    const d = db();
    const update = accountUpdate(patch);
    if (Object.keys(update).length) {
      await d.update(accounts).set(update).where(eq(accounts.email, email.toLowerCase()));
    }
    const [row] = await d.select().from(accounts).where(eq(accounts.email, email.toLowerCase())).limit(1);
    if (!row) return AccountSchema.parse({});
    if (patch.favorites !== undefined) await setFavorites(d, row.id, patch.favorites);
    return toAccount(row, await favSlugs(d, row.id));
  },
};
