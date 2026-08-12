/**
 * Admin entity views (docs/ADMIN.md §8, §4): the god-view over profiles (the
 * "girls"), clients, and platform stats. Reads the shared seams — including
 * their admin-capable surface (`listAll`/`byId`/`setState`), so state changes
 * are real UPDATEs on the profiles row and the who/why lives in `audit_log`.
 */
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { profilesApi } from '@/app/api/profiles';
import type { Profile } from '@/app/models/profile';
import { profileAge } from '@/app/models/profile';
import type { ProfileState } from '@/lib/taxonomy';



// --- profile state (a real column now; audit_log keeps the who/why) --------
export async function setProfileState(id: string, state: ProfileState, _by: string, _reason?: string): Promise<void> {
  await profilesApi.setState(id, state);
}
export async function setProfileUnlisted(id: string, unlisted: boolean): Promise<void> {
  await profilesApi.setUnlisted(id, unlisted);
}

// --- completeness + quality flags -----------------------------------------
export function completeness(p: Profile): number {
  const checks = [
    !!p.name,
    !!p.birthDate,
    !!p.city,
    p.priceFrom > 0,
    p.services.length >= 3,
    p.photos.length >= 3,
    (p.description?.length ?? 0) >= 60,
    Object.keys(p.openingHours ?? {}).length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
export function qualityFlags(p: Profile): string[] {
  const flags: string[] = [];
  if (p.photos.length <= 1) flags.push('1 photo');
  if (p.priceFrom <= 0) flags.push('no rate');
  const days = (Date.now() - new Date(p.createdAt).getTime()) / 86_400_000;
  if (days > 90) flags.push('stale');
  return flags;
}

export interface AdminProfile {
  id: string;
  slug: string;
  name: string;
  age: number;
  gender: string;
  city: string;
  state: ProfileState;
  verified: boolean;
  online: boolean;
  featured: boolean;
  unlisted: boolean;
  orgId?: string;
  priceFrom: number;
  photos: string[];
  servicesCount: number;
  completeness: number;
  flags: string[];
  stateReason?: string;
  createdAt: string;
}

async function enrich(profiles: Profile[]): Promise<AdminProfile[]> {
  return profiles.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    age: profileAge(p.birthDate),
    gender: p.gender,
    city: p.city,
    state: p.state,
    verified: p.verified,
    online: p.online,
    featured: p.featured,
    unlisted: p.unlisted,
    orgId: p.orgId,
    priceFrom: p.priceFrom,
    photos: p.photos,
    servicesCount: p.services.length,
    completeness: completeness(p),
    flags: qualityFlags(p),
    createdAt: p.createdAt,
  }));
}

export interface ProfileFilters {
  q?: string;
  state?: string;
  city?: string;
  gender?: string;
  onlineOnly?: boolean;
  verifiedOnly?: boolean;
}
export async function listProfilesAdmin(f: ProfileFilters = {}): Promise<AdminProfile[]> {
  // Admin sees EVERY state (drafts, pending, blocked) — not the public shelf.
  let rows = await enrich(await profilesApi.listAll());
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.city.includes(q)); }
  // Default view hides the dead (deleted/blocked) — surface them only when the
  // state filter explicitly asks for them.
  if (f.state) rows = rows.filter((r) => r.state === f.state);
  else rows = rows.filter((r) => r.state !== 'deleted' && r.state !== 'blocked');
  if (f.city) rows = rows.filter((r) => r.city === f.city);
  if (f.gender) rows = rows.filter((r) => r.gender === f.gender);
  if (f.onlineOnly) rows = rows.filter((r) => r.online);
  if (f.verifiedOnly) rows = rows.filter((r) => r.verified);
  // Newest first.
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
export async function profileByIdAdmin(id: string): Promise<{ profile: Profile; admin: AdminProfile } | null> {
  const profile = await profilesApi.byId(id);
  if (!profile) return null;
  const admin = (await enrich([profile]))[0]!;
  return { profile, admin };
}

// --- clients --------------------------------------------------------------
export interface AdminClient {
  email: string;
  name: string;
  favorites: number;
  phoneVerified: boolean;
  reportsMade: number;
}
export async function listClients(): Promise<AdminClient[]> {
  const [accounts, reports] = await Promise.all([accountApi.all(), reportsApi.list()]);
  // `account_type` is a real column now — no email/slug guessing.
  return accounts
    .filter((a) => a.accountType === 'client')
    .map((a) => ({
      email: a.email,
      name: a.displayName,
      favorites: a.favorites.length,
      phoneVerified: !!a.phoneVerifiedAt,
      reportsMade: reports.filter((r) => r.reporterEmail === a.email).length,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

// --- command-center stats (§4) --------------------------------------------
export interface CommandStats {
  profilesByState: { state: string; count: number }[];
  byGender: { gender: string; count: number }[];
  advertisers: number;
  clients: number;
  verifiedPct: number;
  onlineNow: number;
  avgCompleteness: number;
  totalPhotos: number;
}
export async function commandStats(): Promise<CommandStats> {
  const [rows, clients, accounts] = await Promise.all([listProfilesAdmin(), listClients(), accountApi.all()]);
  const byState = new Map<string, number>();
  const byGender = new Map<string, number>();
  for (const r of rows) {
    byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
    byGender.set(r.gender, (byGender.get(r.gender) ?? 0) + 1);
  }
  const verified = rows.filter((r) => r.verified).length;
  return {
    profilesByState: [...byState.entries()].map(([state, count]) => ({ state, count })),
    byGender: [...byGender.entries()].map(([gender, count]) => ({ gender, count })).sort((a, b) => b.count - a.count),
    advertisers: rows.length,
    clients: clients.length,
    verifiedPct: rows.length ? Math.round((verified / rows.length) * 100) : 0,
    onlineNow: rows.filter((r) => r.online).length,
    avgCompleteness: rows.length ? Math.round(rows.reduce((s, r) => s + r.completeness, 0) / rows.length) : 0,
    totalPhotos: rows.reduce((s, r) => s + r.photos.length, 0),
    // accounts count is used by overview()
  } satisfies CommandStats;
}
