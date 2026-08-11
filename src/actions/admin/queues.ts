/**
 * Queue builders (docs/ADMIN.md §4–7). Assemble the admin queues from the
 * shared seams (accounts, reports, profiles) + the tables (pending media) +
 * live claims (ephemeral, KV). Read-only helpers used by admin pages; mutations
 * live in ./index.ts. In prod these become Postgres views/functions (§13).
 */
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { accounts, media, profiles } from '@/db/schema';
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { profilesApi } from '@/app/api/profiles';
import { getClaims } from './lib';
import { emailProfileApproved } from '@/lib/email';
import type { RejectionReason } from '@/lib/taxonomy';
import type { Profile } from '@/app/models/profile';
import type { ApprovalItem, Overview, ReportItem } from './types';

const adb = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

const CITY_TARGET = 10; // supply goal per city

// --- Profile approval queue (§5) — the merged queue ------------------------
// One item per pending submission, unioned from three signals: a pending ID
// document, a profile awaiting first publish, and pending photos. Keyed by
// profile (or account, for an ID with no profile yet) so a new professional —
// who trips all three at once — surfaces as ONE row, reviewed and decided in
// one place. Claims live under `approve:<key>`.
export async function approvalQueue(): Promise<ApprovalItem[]> {
  const [accts, allProfiles, pendingMedia, claims] = await Promise.all([
    accountApi.all(),
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
  const bySlug = new Map(allProfiles.map((p) => [p.slug, p]));

  const items = new Map<string, ApprovalItem>();
  const touch = (key: string, name: string): ApprovalItem => {
    let it = items.get(key);
    if (!it) {
      it = { key, email: null, profileName: name, phoneVerified: false, submittedAt: '', idPending: false, profilePending: false, media: [], claim: null };
      items.set(key, it);
    }
    return it;
  };
  const earlier = (a: string, b: string) => (!a ? b : !b ? a : a < b ? a : b);
  const attach = (it: ApprovalItem, p: Profile) => {
    it.profileId = p.id;
    it.profileName = p.name;
    it.profileSlug = p.slug;
    it.birthDate = p.birthDate;
    it.city = p.city;
  };

  // 1) Accounts with a pending ID document.
  for (const a of accts.filter((a) => a.idVerification === 'pending')) {
    const p = a.profileSlug ? bySlug.get(a.profileSlug) : undefined; // real link, no heuristic
    const it = touch(p ? `profile:${p.id}` : `acct:${a.email}`, a.displayName ?? a.email);
    it.email = a.email;
    it.idPending = true;
    it.phoneVerified = Boolean(a.phoneVerifiedAt);
    it.submittedAt = earlier(it.submittedAt, a.verificationSubmittedAt ?? '');
    if (p) attach(it, p);
  }
  // 2) Profiles awaiting their first publish.
  for (const p of allProfiles.filter((p) => p.state === 'pending_review')) {
    const it = touch(`profile:${p.id}`, p.name);
    it.profilePending = true;
    attach(it, p);
    it.submittedAt = earlier(it.submittedAt, p.createdAt);
  }
  // 3) Photos awaiting review (grouped per profile).
  for (const md of pendingMedia) {
    const it = touch(`profile:${md.profileId}`, md.profileName);
    it.profileId = md.profileId;
    it.profileName = md.profileName;
    it.profileSlug = md.profileSlug;
    it.media.push({ id: md.mediaId, imageKey: md.imageKey, nsfwScore: md.nsfwScore ?? 0 });
    it.submittedAt = earlier(it.submittedAt, md.createdAt.toISOString());
  }

  for (const it of items.values()) it.claim = claims[`approve:${it.key}`] ?? null;
  return [...items.values()].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)); // oldest first
}

// --- Reports queue (§7) ---------------------------------------------------
export async function reportsQueue(): Promise<ReportItem[]> {
  const [reports, claims] = await Promise.all([reportsApi.list(), getClaims()]);
  return reports
    .filter((r) => r.state === 'open')
    .map((r) => ({ ...r, claim: claims[`report:${r.id}`] ?? null }))
    .sort((a, b) => Number(b.escalated) - Number(a.escalated) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * The merge: one approval completes a whole submission — ID verification +
 * profile publish + its pending photos — so an admin never has to approve the
 * same person in two places. Callable by email (verification queue) or by
 * profileId (moderation/profiles), whichever the admin acted from.
 */
export async function approveWholeSubmission(by: { email?: string; profileId?: string }): Promise<void> {
  const d = adb();
  // Resolve account + profile from whichever key we were given.
  let accountId: string | undefined;
  let profileId = by.profileId;
  if (by.email) {
    const [acc] = await d.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, by.email));
    accountId = acc?.id;
    if (accountId && !profileId) {
      const [p] = await d.select({ id: profiles.id }).from(profiles).where(eq(profiles.accountId, accountId));
      profileId = p?.id;
    }
  } else if (profileId) {
    const [p] = await d.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.id, profileId));
    accountId = p?.accountId;
  }
  // Clear a pending ID verification.
  let verified = false;
  if (accountId) {
    const rows = await d
      .update(accounts)
      .set({ idVerification: 'approved' })
      .where(and(eq(accounts.id, accountId), eq(accounts.idVerification, 'pending')))
      .returning({ id: accounts.id });
    verified = rows.length > 0;
  }
  // Publish a submitted profile + approve its pending photos.
  let publishedSlug: string | undefined;
  if (profileId) {
    const rows = await d
      .update(profiles)
      .set({ state: 'live' })
      .where(and(eq(profiles.id, profileId), eq(profiles.state, 'pending_review')))
      .returning({ slug: profiles.slug });
    publishedSlug = rows[0]?.slug;
    await d.update(media).set({ state: 'approved' }).where(and(eq(media.profileId, profileId), eq(media.state, 'pending_review')));
  }
  // Tell her — only when something actually flipped (approve is re-runnable;
  // a second click must not re-send the mail).
  if (accountId && (verified || publishedSlug)) {
    const [acc] = await d.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, accountId));
    if (acc?.email) emailProfileApproved(acc.email, publishedSlug);
  }
}

/**
 * The mirror of approveWholeSubmission: one rejection with one reason sends the
 * whole submission back — ID → rejected (reason shown to her verbatim), profile
 * → draft (resubmit), pending photos → rejected. Each step is state-guarded, so
 * rejecting a live profile's newly-added photos never un-publishes the profile.
 */
export async function rejectWholeSubmission(by: { email?: string; profileId?: string }, reason: RejectionReason): Promise<void> {
  const d = adb();
  let accountId: string | undefined;
  let profileId = by.profileId;
  if (by.email) {
    const [acc] = await d.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, by.email));
    accountId = acc?.id;
    if (accountId && !profileId) {
      const [p] = await d.select({ id: profiles.id }).from(profiles).where(eq(profiles.accountId, accountId));
      profileId = p?.id;
    }
  } else if (profileId) {
    const [p] = await d.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.id, profileId));
    accountId = p?.accountId ?? undefined;
  }
  if (accountId) {
    await d
      .update(accounts)
      .set({ idVerification: 'rejected', verificationReason: reason })
      .where(and(eq(accounts.id, accountId), eq(accounts.idVerification, 'pending')));
  }
  if (profileId) {
    await d.update(profiles).set({ state: 'draft' }).where(and(eq(profiles.id, profileId), eq(profiles.state, 'pending_review')));
    await d.update(media).set({ state: 'rejected' }).where(and(eq(media.profileId, profileId), eq(media.state, 'pending_review')));
  }
}

/** Light badges for the shell (nav counts). */
export async function adminBadges(): Promise<{ escalations: number; reportsOpen: number; approvalsOpen: number }> {
  const [escalations, reportsOpen, approvals] = await Promise.all([
    reportsApi.escalationCount(),
    reportsApi.openCount(),
    approvalQueue(),
  ]);
  return { escalations, reportsOpen, approvalsOpen: approvals.length };
}

// --- Overview cockpit (§4) ------------------------------------------------
export async function overview(): Promise<Overview> {
  const [approvals, reports, accounts, allProfiles, escalations] = await Promise.all([
    approvalQueue(),
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
    queues: { approvals: approvals.length, reports: reports.length },
    oldest: {
      approvals: approvals[0]?.submittedAt ?? null,
      reports: reports[0]?.createdAt ?? null,
    },
    today: {
      registrations: accounts.length,
      submitted: approvals.length,
      published: allProfiles.filter((p) => p.state === 'live').length,
      reports: reports.length,
    },
    escalations,
    onlineNow: allProfiles.filter((p) => p.online).length,
    supply,
  };
}
