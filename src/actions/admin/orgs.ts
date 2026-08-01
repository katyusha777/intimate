/**
 * Organizations / agencies (docs/ADMIN.md §8). KvK + verification, members,
 * roster with per-profile states, aggregate quality. Agencies don't exist in
 * the mock account layer yet, so this is a seeded mock referencing real
 * profiles; the real backend replaces it with the orgs + org_members tables.
 */
import { env } from 'cloudflare:workers';
import { profilesApi } from '@/app/api/profiles';
import { completeness } from './entities';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}

export interface Org {
  id: string;
  name: string;
  kvk: string;
  verified: boolean;
  city: string;
  memberSlugs: string[];
}
export interface OrgMember {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  verified: boolean;
  completeness: number;
}
export interface OrgWithRoster extends Org {
  members: OrgMember[];
  avgCompleteness: number;
  liveCount: number;
}

const KEY = 'admin:orgs';
const FLAG = 'admin:orgs:seeded';

async function readOrgs(): Promise<Org[]> {
  const raw = await kv()?.get(KEY);
  try {
    return raw ? (JSON.parse(raw) as Org[]) : [];
  } catch {
    return [];
  }
}

async function seedOrgs(): Promise<void> {
  if (await kv()?.get(FLAG)) return;
  await kv()?.put(FLAG, '1');
  const { items } = await profilesApi.list({ limit: 30 });
  const slugs = items.map((p) => p.slug);
  const orgs: Org[] = [
    { id: 'org_velvet', name: 'Velvet Collective', kvk: 'NL-84213097', verified: true, city: 'amsterdam', memberSlugs: slugs.slice(0, 4) },
    { id: 'org_aurora', name: 'Aurora Agency', kvk: 'NL-77120544', verified: false, city: 'rotterdam', memberSlugs: slugs.slice(4, 7) },
  ];
  await kv()?.put(KEY, JSON.stringify(orgs));
}

async function roster(org: Org): Promise<OrgWithRoster> {
  const { items } = await profilesApi.list({ limit: 30 });
  const members: OrgMember[] = org.memberSlugs.flatMap((slug) => {
    const p = items.find((x) => x.slug === slug);
    if (!p) return [];
    return [{ id: p.id, slug: p.slug, name: p.name, city: p.city, state: p.state, verified: p.verified, completeness: completeness(p) }];
  });
  const avg = members.length ? Math.round(members.reduce((s, m) => s + m.completeness, 0) / members.length) : 0;
  return { ...org, members, avgCompleteness: avg, liveCount: members.filter((m) => m.state === 'live').length };
}

export async function listOrgs(): Promise<OrgWithRoster[]> {
  await seedOrgs();
  const orgs = await readOrgs();
  return Promise.all(orgs.map(roster));
}
export async function orgById(id: string): Promise<OrgWithRoster | null> {
  await seedOrgs();
  const org = (await readOrgs()).find((o) => o.id === id);
  return org ? roster(org) : null;
}
