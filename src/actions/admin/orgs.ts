/**
 * Organizations / agencies (docs/ADMIN.md §8) — the `orgs` table + roster
 * derived from `profiles.org_id` (no join table). Agencies aren't self-service
 * yet, so a couple of demo orgs are seeded once (owning agency accounts +
 * linked profiles) so the surface is demoable; real agencies replace them.
 */
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '@/db/client';
import { accounts, orgs, profiles } from '@/db/schema';
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

const VELVET = '00000000-0000-4000-a100-000000000001';
const AURORA = '00000000-0000-4000-a100-000000000002';

async function seedOrgs(d: Db): Promise<void> {
  if ((await d.select({ id: orgs.id }).from(orgs).limit(1)).length) return;
  await d
    .insert(accounts)
    .values([
      { id: VELVET, accountType: 'agency', email: 'velvet@demo.intimate.nl', displayName: 'Velvet Collective' },
      { id: AURORA, accountType: 'agency', email: 'aurora@demo.intimate.nl', displayName: 'Aurora Agency' },
    ])
    .onConflictDoNothing();
  const [velvet] = await d
    .insert(orgs)
    .values({ accountId: VELVET, name: 'Velvet Collective', kvk: 'NL-84213097', verified: true, city: 'amsterdam' })
    .returning({ id: orgs.id });
  const [aurora] = await d
    .insert(orgs)
    .values({ accountId: AURORA, name: 'Aurora Agency', kvk: 'NL-77120544', verified: false, city: 'rotterdam' })
    .returning({ id: orgs.id });
  // Link a few live profiles as demo members.
  const { items } = await profilesApi.list({ limit: 10 });
  const ids = items.map((p) => p.id);
  for (const id of ids.slice(0, 4)) if (velvet) await d.update(profiles).set({ orgId: velvet.id }).where(eq(profiles.id, id));
  for (const id of ids.slice(4, 7)) if (aurora) await d.update(profiles).set({ orgId: aurora.id }).where(eq(profiles.id, id));
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
  await seedOrgs(d);
  const rows = await d.select().from(orgs);
  return Promise.all(rows.map((r) => roster(d, toOrg(r))));
}
export async function orgById(id: string): Promise<OrgWithRoster | null> {
  const d = adb();
  await seedOrgs(d);
  const [row] = await d.select().from(orgs).where(eq(orgs.id, id)).limit(1);
  return row ? roster(d, toOrg(row)) : null;
}
