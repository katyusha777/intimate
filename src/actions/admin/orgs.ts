/**
 * Organizations / agencies (docs/ADMIN.md §8) — the `orgs` table + roster
 * derived from `profiles.org_id` (no join table). Agencies aren't self-service
 * yet; the table fills as real agencies are onboarded.
 */
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';
import { orgs, profiles } from '@/db/schema';
import { profilesApi } from '@/app/api/profiles';
import { completeness } from './entities';

const adb = (): Db => createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

export interface Org {
  id: string;
  name: string;
  kvk: string;
  verified: boolean;
  city: string;
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

async function roster(d: Db, org: Org): Promise<OrgWithRoster> {
  const ids = (await d.select({ id: profiles.id }).from(profiles).where(eq(profiles.orgId, org.id))).map((r) => r.id);
  const members: OrgMember[] = [];
  for (const id of ids) {
    const p = await profilesApi.byId(id); // full projection → completeness
    if (p) members.push({ id: p.id, slug: p.slug, name: p.name, city: p.city, state: p.state, verified: p.verified, completeness: completeness(p) });
  }
  const avg = members.length ? Math.round(members.reduce((s, m) => s + m.completeness, 0) / members.length) : 0;
  return { ...org, members, avgCompleteness: avg, liveCount: members.filter((m) => m.state === 'live').length };
}

const toOrg = (r: typeof orgs.$inferSelect): Org => ({ id: r.id, name: r.name, kvk: r.kvk, verified: r.verified, city: r.city });

export async function listOrgs(): Promise<OrgWithRoster[]> {
  const d = adb();
  const rows = await d.select().from(orgs);
  return Promise.all(rows.map((r) => roster(d, toOrg(r))));
}
export async function orgById(id: string): Promise<OrgWithRoster | null> {
  const d = adb();
  const [row] = await d.select().from(orgs).where(eq(orgs.id, id)).limit(1);
  return row ? roster(d, toOrg(row)) : null;
}
