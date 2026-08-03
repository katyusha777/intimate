/**
 * Queue builders (docs/ADMIN.md §4–7). Assemble the admin queues from the
 * shared seams (accounts, reports, profiles) + the tables (pending media) +
 * live claims (ephemeral, KV). Read-only helpers used by admin pages; mutations
 * live in ./index.ts. In prod these become Postgres views/functions (§13).
 */
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';
import { media, profiles } from '@/db/schema';
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { profilesApi } from '@/app/api/profiles';
import { getClaims } from './lib';
import type { ModerationItem, Overview, ReportItem, VerificationItem } from './types';

const adb = (): Db => createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

const CITY_TARGET = 10; // supply goal per city

// --- Verification queue (§5) ----------------------------------------------
export async function verificationQueue(): Promise<VerificationItem[]> {
  const [accounts, allProfiles, claims] = await Promise.all([
    accountApi.all(),
    profilesApi.listAll(),
    getClaims(),
  ]);
  const bySlug = new Map(allProfiles.map((p) => [p.slug, p]));
  return accounts
    .filter((a) => a.idVerification === 'pending')
    .map((a) => {
      const p = a.profileSlug ? bySlug.get(a.profileSlug) : undefined; // real link, no heuristic
      return {
        email: a.email,
        profileId: p?.id,
        profileName: p?.name ?? a.displayName ?? a.email,
        profileSlug: p?.slug,
        submittedAt: a.verificationSubmittedAt ?? '',
        phoneVerified: Boolean(a.phoneVerifiedAt),
        state: a.idVerification,
        claim: claims[`verify:${a.email.toLowerCase()}`] ?? null,
      } satisfies VerificationItem;
    })
    .sort((x, y) => x.submittedAt.localeCompare(y.submittedAt)); // oldest first
}

// --- Reports queue (§7) ---------------------------------------------------
export async function reportsQueue(): Promise<ReportItem[]> {
  const [reports, claims] = await Promise.all([reportsApi.list(), getClaims()]);
  return reports
    .filter((r) => r.state === 'open')
    .map((r) => ({ ...r, claim: claims[`report:${r.id}`] ?? null }))
    .sort((a, b) => Number(b.escalated) - Number(a.escalated) || a.createdAt.localeCompare(b.createdAt));
}

// --- Moderation queue (§6) — DERIVED from real pending data ----------------
// New profiles awaiting first approval + media awaiting review. Text edits
// publish immediately (no edit-review), so there is no profile_edit kind.
export async function moderationQueue(): Promise<ModerationItem[]> {
  const [allProfiles, pendingMedia, claims] = await Promise.all([
    profilesApi.listAll(),
    adb()
      .select({
        mediaId: media.id,
        imageKey: media.imageKey,
        nsfwScore: media.nsfwScore,
        profileId: profiles.id,
        profileName: profiles.name,
        profileSlug: profiles.slug,
        createdAt: media.createdAt,
      })
      .from(media)
      .innerJoin(profiles, eq(profiles.id, media.profileId))
      .where(eq(media.state, 'pending_review')),
    getClaims(),
  ]);

  const items: ModerationItem[] = [];
  for (const p of allProfiles.filter((p) => p.state === 'pending_review')) {
    items.push({
      id: `profile:${p.id}`,
      kind: 'new_profile',
      profileId: p.id,
      profileName: p.name,
      profileSlug: p.slug,
      submittedAt: p.createdAt,
      diff: [],
      media: [],
      claim: claims[`mod:profile:${p.id}`] ?? null,
    });
  }
  // Group pending media by profile → one 'media' item per profile.
  const byProfile = new Map<string, ModerationItem>();
  for (const m of pendingMedia) {
    const item =
      byProfile.get(m.profileId) ??
      byProfile
        .set(m.profileId, {
          id: `media:${m.profileId}`,
          kind: 'media',
          profileId: m.profileId,
          profileName: m.profileName,
          profileSlug: m.profileSlug,
          submittedAt: m.createdAt.toISOString(),
          diff: [],
          media: [],
          claim: claims[`mod:media:${m.profileId}`] ?? null,
        })
        .get(m.profileId)!;
    item.media.push({ id: m.mediaId, imageKey: m.imageKey, nsfwScore: m.nsfwScore ?? 0 });
  }
  items.push(...byProfile.values());
  return items.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/**
 * Act on a moderation item (replaces the mock's KV removal): approve/reject the
 * underlying entity. `profile:<id>` → live | draft (resubmit); `media:<id>` →
 * approve/reject all that profile's pending media.
 */
export async function decideModeration(id: string, approve: boolean): Promise<void> {
  const [kind, entityId] = id.split(':');
  if (!entityId) return;
  if (kind === 'profile') {
    await profilesApi.setState(entityId, approve ? 'live' : 'draft');
  } else if (kind === 'media') {
    await adb()
      .update(media)
      .set({ state: approve ? 'approved' : 'rejected' })
      .where(and(eq(media.profileId, entityId), eq(media.state, 'pending_review')));
  }
}

/** Light badges for the shell (escalation banner + nav counts) — no heavy builds. */
export async function adminBadges(): Promise<{ escalations: number; reportsOpen: number }> {
  const [escalations, reportsOpen] = await Promise.all([reportsApi.escalationCount(), reportsApi.openCount()]);
  return { escalations, reportsOpen };
}

// --- Overview cockpit (§4) ------------------------------------------------
export async function overview(): Promise<Overview> {
  const [verification, moderation, reports, accounts, allProfiles, escalations] = await Promise.all([
    verificationQueue(),
    moderationQueue(),
    reportsQueue(),
    accountApi.all(),
    profilesApi.listAll(),
    reportsApi.escalationCount(),
  ]);
  const bySupply = new Map<string, number>();
  for (const p of allProfiles) if (p.state === 'live') bySupply.set(p.city, (bySupply.get(p.city) ?? 0) + 1);
  const supply = [...bySupply.entries()]
    .map(([city, live]) => ({ city, live, target: CITY_TARGET }))
    .sort((a, b) => b.live - a.live)
    .slice(0, 8);
  return {
    queues: { verification: verification.length, moderation: moderation.length, reports: reports.length },
    oldest: {
      verification: verification[0]?.submittedAt ?? null,
      moderation: moderation[0]?.submittedAt ?? null,
      reports: reports[0]?.createdAt ?? null,
    },
    today: {
      registrations: accounts.length,
      submitted: verification.length,
      published: allProfiles.filter((p) => p.state === 'live').length,
      reports: reports.length,
    },
    escalations,
    onlineNow: allProfiles.filter((p) => p.online).length,
    supply,
  };
}
