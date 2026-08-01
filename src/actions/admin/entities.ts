/**
 * Admin entity views (docs/ADMIN.md §8, §4): the god-view over profiles (the
 * "girls"), clients, and platform stats. Reads the shared seams; profile state
 * changes are stored as admin overrides in KV (the mock stand-in for the
 * profiles table's state column) so the shared profilesApi stays untouched.
 */
import { env } from 'cloudflare:workers';
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { profilesApi } from '@/app/api/profiles';
import type { Profile } from '@/app/models/profile';
import { profileAge } from '@/app/models/profile';
import type { ProfileState } from '@/lib/taxonomy';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}
const now = () => new Date().toISOString();

const ADMIN_SET = new Set(['admin@intimate.nl', 'mod@intimate.nl', 'support@intimate.nl']);
const localPart = (e: string) => (e.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// --- profile state overrides ----------------------------------------------
const PSTATE_KEY = 'admin:pstate';
interface PState { state: ProfileState; reason?: string; at: string; by: string }
async function readPStates(): Promise<Record<string, PState>> {
  const raw = await kv()?.get(PSTATE_KEY);
  try { return raw ? (JSON.parse(raw) as Record<string, PState>) : {}; } catch { return {}; }
}
export async function setProfileState(id: string, state: ProfileState, by: string, reason?: string): Promise<void> {
  const all = await readPStates();
  all[id] = { state, reason, at: now(), by };
  await kv()?.put(PSTATE_KEY, JSON.stringify(all));
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
  priceFrom: number;
  photos: string[];
  servicesCount: number;
  completeness: number;
  flags: string[];
  stateReason?: string;
  createdAt: string;
}

async function enrich(profiles: Profile[]): Promise<AdminProfile[]> {
  const overrides = await readPStates();
  return profiles.map((p) => {
    const o = overrides[p.id];
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      age: profileAge(p.birthDate),
      gender: p.gender,
      city: p.city,
      state: o?.state ?? p.state,
      verified: p.verified,
      online: p.online,
      featured: p.featured,
      priceFrom: p.priceFrom,
      photos: p.photos,
      servicesCount: p.services.length,
      completeness: completeness(p),
      flags: qualityFlags(p),
      stateReason: o?.reason,
      createdAt: p.createdAt,
    };
  });
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
  const { items } = await profilesApi.list({ limit: 60 });
  let rows = await enrich(items);
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.city.includes(q)); }
  if (f.state) rows = rows.filter((r) => r.state === f.state);
  if (f.city) rows = rows.filter((r) => r.city === f.city);
  if (f.gender) rows = rows.filter((r) => r.gender === f.gender);
  if (f.onlineOnly) rows = rows.filter((r) => r.online);
  if (f.verifiedOnly) rows = rows.filter((r) => r.verified);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
export async function profileByIdAdmin(id: string): Promise<{ profile: Profile; admin: AdminProfile } | null> {
  const { items } = await profilesApi.list({ limit: 60 });
  const profile = items.find((p) => p.id === id);
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
  const [accounts, { items: profiles }, reports] = await Promise.all([
    accountApi.all(),
    profilesApi.list({ limit: 60 }),
    reportsApi.list(),
  ]);
  const isAdvertiser = (e: string) => profiles.some((p) => p.slug.startsWith(localPart(e)));
  return accounts
    .filter((a) => !ADMIN_SET.has(a.email) && !isAdvertiser(a.email))
    .map((a) => ({
      email: a.email,
      name: (localPart(a.email) || 'client').replace(/^\w/, (c) => c.toUpperCase()),
      favorites: a.favorites.length,
      phoneVerified: !!a.phoneVerifiedAt,
      reportsMade: reports.filter((r) => r.reporterEmail === a.email).length,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** Seed demo client accounts so the directory is populated (once). */
export async function seedClients(): Promise<void> {
  const FLAG = 'admin:clients:seeded';
  if (await kv()?.get(FLAG)) return;
  await kv()?.put(FLAG, '1');
  const demo: { email: string; favorites: string[]; phone?: string }[] = [
    { email: 'daan@example.com', favorites: ['lena-nijmegen', 'elif-leiden'], phone: '+31612345678' },
    { email: 'thomas@example.com', favorites: ['vera-deventer'] },
    { email: 'sven@example.com', favorites: [], phone: '+31698765432' },
    { email: 'lucas@example.com', favorites: ['yasmin-breda', 'romy-zwolle', 'lena-nijmegen'], phone: '+31611122233' },
    { email: 'noah@example.com', favorites: ['elif-leiden'] },
    { email: 'sem@example.com', favorites: [] },
    { email: 'finn@example.com', favorites: ['romy-zwolle'], phone: '+31622233344' },
  ];
  for (const d of demo) {
    await accountApi.saveByEmail(d.email, {
      favorites: d.favorites,
      ...(d.phone ? { phone: d.phone, phoneVerifiedAt: now() } : {}),
    });
  }
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
