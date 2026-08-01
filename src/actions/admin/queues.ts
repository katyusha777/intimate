/**
 * Queue builders (docs/ADMIN.md §4–7). Assemble the admin queues from the
 * shared seams (accounts, reports, profiles) + seeded moderation items + live
 * claims. Read-only helpers used by admin pages; mutations live in ./index.ts.
 * In prod these become Postgres views/functions (§13).
 */
import { env } from 'cloudflare:workers';
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { profilesApi } from '@/app/api/profiles';
import type { Profile } from '@/app/models/profile';
import { getClaims } from './lib';
import type { ModerationItem, Overview, ReportItem, VerificationItem } from './types';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}

const localPart = (email: string) => (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Mock profile linkage: advertiser email local-part → matching profile slug. */
function resolveProfile(email: string, profiles: Profile[]): Profile | undefined {
  const lp = localPart(email);
  return profiles.find((p) => p.slug.startsWith(lp));
}

const CITY_TARGET = 10; // mock supply goal per city

// --- Verification queue (§5) ----------------------------------------------
export async function verificationQueue(): Promise<VerificationItem[]> {
  const [accounts, { items: profiles }, claims] = await Promise.all([
    accountApi.all(),
    profilesApi.list({ limit: 60 }),
    getClaims(),
  ]);
  return accounts
    .filter((a) => a.idVerification === 'pending')
    .map((a) => {
      const p = resolveProfile(a.email, profiles);
      return {
        email: a.email,
        profileId: p?.id,
        profileName: a.profileOverride?.name ?? p?.name ?? a.email,
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
    .sort(
      (a, b) =>
        Number(b.escalated) - Number(a.escalated) || a.createdAt.localeCompare(b.createdAt),
    );
}

// --- Moderation queue (§6) — seeded mock items ----------------------------
const MOD_KEY = 'admin:moderation';
const MOD_SEED_FLAG = 'admin:moderation:seeded';

async function readModeration(): Promise<ModerationItem[]> {
  const raw = await kv()?.get(MOD_KEY);
  try {
    return raw ? (JSON.parse(raw) as ModerationItem[]) : [];
  } catch {
    return [];
  }
}
export async function writeModeration(items: ModerationItem[]): Promise<void> {
  await kv()?.put(MOD_KEY, JSON.stringify(items));
}

/** Seed a couple of realistic moderation items once (demo). */
async function seedModeration(): Promise<void> {
  if (await kv()?.get(MOD_SEED_FLAG)) return;
  await kv()?.put(MOD_SEED_FLAG, '1');
  const { items: profiles } = await profilesApi.list({ limit: 6 });
  const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const seed: ModerationItem[] = [];
  if (profiles[0]) {
    seed.push({
      id: 'mod_edit_1',
      kind: 'profile_edit',
      profileId: profiles[0].id,
      profileName: profiles[0].name,
      profileSlug: profiles[0].slug,
      submittedAt: min(35),
      diff: [
        { field: 'priceFrom', before: `€${profiles[0].priceFrom}`, after: `€${profiles[0].priceFrom + 30}` },
        { field: 'description', before: profiles[0].description.slice(0, 60) + '…', after: 'New here, available this week for outcall in the city centre…' },
      ],
      media: [],
      claim: null,
    });
  }
  if (profiles[1]) {
    seed.push({
      id: 'mod_media_1',
      kind: 'media',
      profileId: profiles[1].id,
      profileName: profiles[1].name,
      profileSlug: profiles[1].slug,
      submittedAt: min(90),
      diff: [],
      media: (profiles[1].photos.slice(0, 3)).map((_, i) => ({
        id: `${profiles[1]!.id}-m${i}`,
        imageKey: `${profiles[1]!.id}-${i}`,
        nsfwScore: [0.82, 0.41, 0.12][i] ?? 0.2,
      })),
      claim: null,
    });
  }
  if (seed.length) await writeModeration(seed);
}

export async function removeModerationItem(id: string): Promise<void> {
  const items = await readModeration();
  await writeModeration(items.filter((m) => m.id !== id));
}

export async function moderationQueue(): Promise<ModerationItem[]> {
  await seedModeration();
  const [items, claims] = await Promise.all([readModeration(), getClaims()]);
  return items
    .map((m) => ({ ...m, claim: claims[`mod:${m.id}`] ?? null }))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** Light badges for the shell (escalation banner + nav counts) — no heavy queue builds. */
export async function adminBadges(): Promise<{ escalations: number; reportsOpen: number }> {
  const [escalations, reportsOpen] = await Promise.all([
    reportsApi.escalationCount(),
    reportsApi.openCount(),
  ]);
  return { escalations, reportsOpen };
}

// --- Overview cockpit (§4) ------------------------------------------------
export async function overview(): Promise<Overview> {
  const [verification, moderation, reports, accounts, { items: profiles }, escalations] =
    await Promise.all([
      verificationQueue(),
      moderationQueue(),
      reportsQueue(),
      accountApi.all(),
      profilesApi.list({ limit: 60 }),
      reportsApi.escalationCount(),
    ]);
  const bySupply = new Map<string, number>();
  for (const p of profiles) if (p.state === 'live') bySupply.set(p.city, (bySupply.get(p.city) ?? 0) + 1);
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
      published: profiles.filter((p) => p.state === 'live').length,
      reports: reports.length,
    },
    escalations,
    onlineNow: profiles.filter((p) => p.online).length,
    supply,
  };
}
