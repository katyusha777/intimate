/**
 * Drizzle backend for accounts + the advertiser's own profile/media (DATA.md).
 * Replaces the KV mock: verification state lives on the `accounts` row,
 * favorites in the `favorites` table, photos in `media`, and profile edits
 * write `profiles` columns directly (publish-immediately, ADMIN.md §6).
 *
 * Fresh Db per call — workerd forbids reusing I/O across requests.
 */
import { env } from 'cloudflare:workers';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { accounts, favorites, media, profiles, verificationDocs } from '@/db/schema';
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
import { CITIES, POLICY_MIN_AGE, VERIFICATION_DOC_KINDS, type VerificationDocKind } from '@/lib/taxonomy';
import { slugifyBase } from '@/lib/slug';
import { evictMediaCache, isR2Key, mediaBucket as bucket } from '@/lib/media-keys';
import { pushoverAdmins } from '@/lib/pushover';
import { rateLimit } from '@/lib/rate-limit';
import type { CacheKv } from '@/lib/page-cache';

/** Admin ping on profile edits, throttled to one per profile per hour — the
 *  onboarding wizard saves on every step and must not machine-gun phones.
 *  IDs only in the payload (SECURITY.md): Pushover is a US processor — never
 *  send emails/names there; admins click through to /admin for identity. */
async function notifyProfileChanged(profileId: string): Promise<void> {
  const kv = (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;
  if (await rateLimit(kv, 'notif-profile', profileId, 1)) {
    pushoverAdmins('profile_changed', 'Profile updated', `profile ${profileId} was edited`);
  }
}
import { createWelcomeThread } from '@/app/data/db/messaging';
import type { Session } from '@/app/models/session';

const db = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
// Toxic-waste ID docs (hard rule 3): a SEPARATE private EU bucket — never the
// public MEDIA one, never public-served, never logged.
const verificationBucket = (): R2Bucket => (env as unknown as { VERIFICATION: R2Bucket }).VERIFICATION;

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

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
    deletionRequestedAt: iso(row.deletionRequestedAt),
    dataRequestedAt: iso(row.dataRequestedAt),
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
    city: CITIES[0]!.slug, // Amsterdam — she corrects it in the wizard
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
    id: row.id,
    email: row.email ?? row.id,
    accountType: row.accountType,
    adminRole: row.adminRole ?? undefined,
    pushoverKey: row.pushoverKey ?? undefined,
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
  if (patch.deletionRequestedAt !== undefined)
    u.deletionRequestedAt = new Date(patch.deletionRequestedAt);
  if (patch.dataRequestedAt !== undefined) u.dataRequestedAt = new Date(patch.dataRequestedAt);
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

/** `Eva` + `amsterdam` → `eva-amsterdam`, deduped against existing slugs.
 *  Exported for the agency crawl pipeline (app/data/db/crawl.ts). */
export async function uniqueSlug(d: Db, name: string, city: string): Promise<string> {
  const base = slugifyBase(`${name}-${city}`, 'profile');
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await d.select({ id: profiles.id }).from(profiles).where(eq(profiles.slug, candidate)).limit(1);
    if (!hit.length) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** ProfileEdit patch → profiles columns (only the keys present).
 *  Exported for the agency crawl pipeline (src/lib/crawl.ts). */
export function profileUpdate(patch: Partial<ProfileEdit>) {
  const u: Record<string, unknown> = {};
  const copy = [
    'name', 'gender', 'city', 'ageDisplay', 'phone', 'whatsapp', 'telegram', 'instagram',
    'rates', 'depositPolicy', 'extrasNote', 'services',
    'meetingTypes', 'languages', 'incallLocations', 'amenities', 'paymentMethods',
    'availableFor', 'bodyType', 'hairColor', 'hairLength', 'eyeColor', 'cupSize',
    'breastType', 'pubicHair', 'appearance', 'nationality', 'heightCm', 'weightKg',
    'shoeSizeEu', 'smoking', 'drinking', 'tattoos', 'piercings', 'openingHours',
    'availabilityDates', 'description',
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

  async setAccountType(accountId, type) {
    // One column update — session.role derives from accounts.accountType, so
    // this is the entire switch (app_metadata is only a validity gate). The
    // post-write read may lag (Hyperdrive/pooler); callers bridge it.
    await db().update(accounts).set({ accountType: type }).where(eq(accounts.id, accountId));
  },

  async saveProfileById(profileId, patch) {
    const d = db();
    const update = profileUpdate(patch);
    if (Object.keys(update).length) {
      await d.update(profiles).set(update).where(eq(profiles.id, profileId));
      await notifyProfileChanged(profileId);
    }
  },

  async recordImportSource(session, url) {
    const d = db();
    const row = await myProfileRow(d, session.accountId);
    if (row) await d.update(profiles).set({ importedFromUrl: url }).where(eq(profiles.id, row.id));
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
        await notifyProfileChanged(existing.id);
      }
      return;
    }
    // First save creates the row — the identity fields are mandatory then.
    const seed = ProfileEditSchema.pick({ name: true, birthDate: true, gender: true, city: true }).parse(patch);
    const [created] = await d
      .insert(profiles)
      .values({
        accountId: session.accountId,
        slug: await uniqueSlug(d, seed.name, seed.city),
        state: 'draft',
        ...(profileUpdate(patch) as { name: string }),
        name: seed.name,
        birthDate: seed.birthDate,
        gender: seed.gender,
        city: seed.city,
      })
      .returning({ id: profiles.id });
    // One-time welcome DM from Team Intimate (feedback v7 #7). Never let a
    // welcome failure block profile creation.
    if (created) {
      try {
        await createWelcomeThread(d, created.id);
      } catch (e) {
        console.error('[welcome] failed', e);
      }
      await notifyProfileChanged(created.id);
    }
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

  async setPaused(session, paused) {
    const d = db();
    // Owner-initiated only, and only between live and paused — a draft/pending
    // profile isn't "paused", and this never publishes an unreviewed profile.
    await d
      .update(profiles)
      .set({ state: paused ? 'paused' : 'live' })
      .where(and(eq(profiles.accountId, session.accountId), eq(profiles.state, paused ? 'live' : 'paused')));
  },

  async setUnlisted(session, unlisted) {
    // Pure visibility flag — no lifecycle transition, so no state guard.
    await db().update(profiles).set({ unlisted }).where(eq(profiles.accountId, session.accountId));
  },

  async addVerificationDoc(session, { kind, bytes }) {
    const d = db();
    const b = verificationBucket();
    const [acc] = await d
      .select({ idVerification: accounts.idVerification })
      .from(accounts)
      .where(eq(accounts.id, session.accountId));
    // Approved accounts need no more documents — refuse quietly (UI never
    // offers this, so only a crafted call lands here).
    if (!acc || acc.idVerification === 'approved') throw new Error('already verified');
    // Under review: the submission must stay exactly what the reviewer is
    // looking at — no retakes (a supersede would delete a doc an open admin
    // drawer is showing). Completing a MISSING kind stays allowed, so legacy
    // single-doc pending accounts can finish their set.
    if (acc.idVerification === 'pending') {
      const existing = await accountApi.verificationDocKinds(session);
      if (existing.includes(kind)) throw new Error('under review');
    }
    // The EXIF-stripped photo → the private EU bucket + a verification_docs row
    // (kind + r2Key + content hash). Keys are namespaced by account; contents
    // are never logged (hard rule 3). purge_after is set later, on deactivation
    // (the 48-month clock starts then), not at submission.
    const r2Key = `${session.accountId}/${crypto.randomUUID()}.jpg`;
    await b.put(r2Key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    let insertedId: string;
    try {
      const [row] = await d
        .insert(verificationDocs)
        .values({ accountId: session.accountId, r2Key, docHash: await sha256Hex(bytes), kind })
        .returning({ id: verificationDocs.id });
      insertedId = row!.id;
    } catch (e) {
      // Never leave orphaned toxic-waste objects if the DB write fails — they'd
      // escape the retention/purge accounting (hard rule 3).
      await b.delete(r2Key).catch(() => {});
      throw e;
    }
    // A retake supersedes the unreviewed photo of the same kind: it was never
    // part of any review, so keeping it would be needless toxic waste — delete
    // bytes AND row (retention applies to reviewed documents, not discards).
    // The row is removed ONLY when its bytes actually left R2: a failed object
    // delete keeps the row, so the object stays visible to the row-driven
    // retention purge (hard rule 3 accounting — an unrowed object would escape
    // it forever) and the next retake retries the delete.
    const stale = await d
      .select({ id: verificationDocs.id, r2Key: verificationDocs.r2Key })
      .from(verificationDocs)
      .where(
        and(
          eq(verificationDocs.accountId, session.accountId),
          eq(verificationDocs.kind, kind),
          eq(verificationDocs.state, 'pending'),
          ne(verificationDocs.id, insertedId),
        ),
      );
    if (stale.length) {
      const deleted = await Promise.allSettled(stale.map((s) => b.delete(s.r2Key)));
      const okIds = stale.filter((_, i) => deleted[i]!.status === 'fulfilled').map((s) => s.id);
      if (okIds.length) await d.delete(verificationDocs).where(inArray(verificationDocs.id, okIds));
    }
    // All required kinds in → flip to pending review. The completeness decision
    // rides the WRITE itself (correlated subquery, executed at origin): a
    // separate re-read here would repeat the exact SELECT the setup page just
    // primed, and Hyperdrive serves cached SELECTs minutes stale after writes
    // (memory: hyperdrive-read-cache-active) — the flip would silently never
    // happen. State guard keeps it one-shot: re-uploads while already pending
    // never re-ping.
    const flipped = await d
      .update(accounts)
      .set({ idVerification: 'pending', verificationSubmittedAt: new Date() })
      .where(
        and(
          eq(accounts.id, session.accountId),
          inArray(accounts.idVerification, ['unverified', 'rejected']),
          sql`(select count(distinct ${verificationDocs.kind}) from ${verificationDocs}
               where ${verificationDocs.accountId} = ${session.accountId}
                 and ${verificationDocs.state} = 'pending'
                 and ${verificationDocs.purgedAt} is null
                 and ${inArray(verificationDocs.kind, [...VERIFICATION_DOC_KINDS])}) = ${VERIFICATION_DOC_KINDS.length}`,
        ),
      )
      .returning({ id: accounts.id });
    if (flipped.length) {
      pushoverAdmins('verification_pending', 'Verification pending', `account ${session.accountId} submitted documents — review at intimate.nl/admin/approvals`);
    }
  },

  async verificationDocKinds(session) {
    const rows = await db()
      .selectDistinct({ kind: verificationDocs.kind })
      .from(verificationDocs)
      .where(
        and(
          eq(verificationDocs.accountId, session.accountId),
          eq(verificationDocs.state, 'pending'),
          isNull(verificationDocs.purgedAt),
          // Legacy kinds (retired paper-code selfie) must not surface as a
          // resume point in today's flow.
          inArray(verificationDocs.kind, [...VERIFICATION_DOC_KINDS]),
        ),
      );
    return rows.map((r) => r.kind as VerificationDocKind);
  },

  // Her gallery = the by-id core scoped to her own profile row. Admin edits the
  // same core by profileId (photosById/addPhotoById/removePhotoById below).
  async photos(session) {
    const row = await myProfileRow(db(), session.accountId);
    return row ? accountApi.photosById(row.id) : [];
  },

  async addPhoto(session, input) {
    const row = await myProfileRow(db(), session.accountId);
    // No profile row → fail loudly (the UI gates on this, but never silently
    // swallow an upload as if it worked).
    if (!row) throw new Error('no profile — save your profile before adding photos');
    await accountApi.addPhotoById(row.id, input);
  },

  async removePhoto(session, { id }) {
    // Scoped to HER profile — an id from another gallery deletes nothing.
    const row = await myProfileRow(db(), session.accountId);
    if (row) await accountApi.removePhotoById(row.id, { id });
  },

  async photosById(profileId) {
    const rows = await db().select().from(media).where(eq(media.profileId, profileId)).orderBy(media.position);
    return rows.map((m): MediaItem => ({ id: m.id, url: mediaUrl(m.imageKey), isPrivate: m.isPrivate, state: m.state }));
  },

  async addPhotoById(profileId, { bytes, isPrivate = false }) {
    const d = db();
    const [agg] = await d
      .select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${media.position}), -1) + 1` })
      .from(media)
      .where(eq(media.profileId, profileId));
    if ((agg?.n ?? 0) >= 20) return; // cap: a gallery, not a dump
    // Key encodes visibility so the /media route can gate without a DB hit on
    // the hot (public) path: `pub/<profileId>/<uuid>` vs `priv/…`.
    const key = `${isPrivate ? 'priv' : 'pub'}/${profileId}/${crypto.randomUUID()}`;
    // contentType is pinned to image/jpeg: uploads are always canvas-re-encoded,
    // EXIF-stripped JPEGs (dataUrlToJpegBytes), and pinning stops a future caller
    // smuggling image/svg+xml (script-bearing) into the public MEDIA bucket.
    await bucket().put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    await d.insert(media).values({
      profileId,
      imageKey: key,
      isPrivate,
      position: agg?.next ?? 0,
      // Advertisers are ID-verified + accountable (and admin is the moderator),
      // so photos publish on upload; bad content is handled reactively.
      state: 'approved',
    });
  },

  async removePhotoById(profileId, { id }) {
    const [gone] = await db()
      .delete(media)
      .where(and(eq(media.id, id), eq(media.profileId, profileId)))
      .returning({ key: media.imageKey });
    if (gone && isR2Key(gone.key)) {
      await bucket().delete(gone.key);
      evictMediaCache([gone.key]); // fire-and-forget; the /media row-gate is the guarantee
    }
  },

  async phoneInUse(phone, exceptAccountId) {
    const d = db();
    const rows = await d
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.phone, phone), isNotNull(accounts.phoneVerifiedAt), ne(accounts.id, exceptAccountId)))
      .limit(1);
    return rows.length > 0;
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
