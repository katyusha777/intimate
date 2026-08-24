/**
 * Organizations / partner agencies (docs/ADMIN.md §8) — the `orgs` table +
 * roster derived from `profiles.org_id` (no join table). Agencies have no
 * login: each org owns a placeholder `agency`-type accounts row that holds its
 * crawled profiles; the crawl pipeline (src/lib/crawl.ts) fills the roster.
 */
import { env } from 'cloudflare:workers';
import { count, desc, eq, sql } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { accounts, importJobs, orgs, profiles } from '@/db/schema';
import { profilesApi } from '@/app/api/profiles';
import { mediaBucket } from '@/lib/media-keys';
import type { CitySlug, ImportJobState } from '@/lib/taxonomy';
import { OrgLocationsSchema, type OrgLocation } from '@/app/models/org';
import { completeness } from './entities';

const adb = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

export interface Org {
  id: string;
  name: string;
  slug: string;
  kvk?: string;
  verified: boolean;
  /** Hidden from ALL public reads (agency page + whole roster) — see schema. */
  unlisted: boolean;
  city: string;
  logoKey?: string;
  siteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  locations: OrgLocation[];
  description: string;
  crawlEnabled: boolean;
  crawlListUrl?: string;
  sitePrompt?: string;
  /** Deterministic import whitelist — see schema.ts orgs.allowed_services. */
  allowedServices?: string[];
  crawlIntervalHours: number;
  lastCrawledAt?: string;
  lastCrawlNote?: string;
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
export interface OrgJob {
  id: string;
  sourceUrl: string;
  state: ImportJobState;
  profileName?: string;
  error?: string;
  createdAt: string;
}
/** The sidebar list needs counts, not rosters — keep it two queries total. */
export interface OrgSummary extends Org {
  memberCount: number;
  liveCount: number;
}
export interface OrgWithRoster extends Org {
  members: OrgMember[];
  avgCompleteness: number;
  liveCount: number;
  jobs: OrgJob[];
}

/** Full roster for ONE org: bulk via profilesApi.byOrg (2 queries) + jobs. */
async function roster(d: Db, org: Org): Promise<OrgWithRoster> {
  const members = (await profilesApi.byOrg(org.id)).map(
    (p): OrgMember => ({ id: p.id, slug: p.slug, name: p.name, city: p.city, state: p.state, verified: p.verified, completeness: completeness(p) }),
  );
  const avg = members.length ? Math.round(members.reduce((s, m) => s + m.completeness, 0) / members.length) : 0;
  const jobRows = await d
    .select()
    .from(importJobs)
    .where(eq(importJobs.orgId, org.id))
    .orderBy(desc(importJobs.createdAt))
    .limit(25);
  const jobs = jobRows.map(
    (j): OrgJob => ({
      id: j.id,
      sourceUrl: j.sourceUrl,
      state: j.state,
      profileName: j.profileName ?? undefined,
      error: j.error ?? undefined,
      createdAt: j.createdAt.toISOString(),
    }),
  );
  return { ...org, members, avgCompleteness: avg, liveCount: members.filter((m) => m.state === 'live').length, jobs };
}

const toOrg = (r: typeof orgs.$inferSelect): Org => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  kvk: r.kvk ?? undefined,
  verified: r.verified,
  unlisted: r.unlisted,
  city: r.city,
  logoKey: r.logoKey ?? undefined,
  siteUrl: r.siteUrl ?? undefined,
  contactEmail: r.contactEmail ?? undefined,
  contactPhone: r.contactPhone ?? undefined,
  locations: r.locations,
  description: r.description,
  crawlEnabled: r.crawlEnabled,
  crawlListUrl: r.crawlListUrl ?? undefined,
  sitePrompt: r.sitePrompt ?? undefined,
  allowedServices: r.allowedServices ?? undefined,
  crawlIntervalHours: r.crawlIntervalHours,
  lastCrawledAt: r.lastCrawledAt?.toISOString(),
  lastCrawlNote: r.lastCrawlNote ?? undefined,
});

export async function listOrgs(): Promise<OrgSummary[]> {
  const d = adb();
  const rows = await d.select().from(orgs);
  // One grouped pass over profiles for every org's counts (was N×members
  // full-projection fetches — multi-second admin loads once rosters filled).
  const counts = await d
    .select({
      orgId: profiles.orgId,
      n: count(),
      live: sql<number>`count(*) filter (where ${profiles.state} = 'live')::int`,
    })
    .from(profiles)
    .groupBy(profiles.orgId);
  const byOrg = new Map(counts.map((c) => [c.orgId, c]));
  return rows.map((r) => {
    const c = byOrg.get(r.id);
    return { ...toOrg(r), memberCount: c?.n ?? 0, liveCount: c?.live ?? 0 };
  });
}
export async function orgById(id: string): Promise<OrgWithRoster | null> {
  const d = adb();
  const [row] = await d.select().from(orgs).where(eq(orgs.id, id)).limit(1);
  return row ? roster(d, toOrg(row)) : null;
}

export interface OrgPatch {
  name?: string;
  city?: CitySlug;
  kvk?: string;
  verified?: boolean;
  unlisted?: boolean;
  siteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  locations?: OrgLocation[];
  description?: string;
  crawlEnabled?: boolean;
  crawlListUrl?: string;
  sitePrompt?: string;
  allowedServices?: string[];
  crawlIntervalHours?: number;
}

// Org creation + manual profile creation live in the shared seam (@/app/api/orgs
// — the public consent form creates orgs too, and only api/data may touch the
// data layer). Re-exported so admin call sites keep their import.
export { createOrg, createManualProfile } from '@/app/api/orgs';

export async function updateOrg(id: string, patch: OrgPatch): Promise<void> {
  const d = adb();
  const u: Partial<typeof orgs.$inferInsert> = {};
  if (patch.name !== undefined) u.name = patch.name;
  if (patch.city !== undefined) u.city = patch.city;
  if (patch.kvk !== undefined) u.kvk = patch.kvk || null;
  if (patch.verified !== undefined) u.verified = patch.verified;
  if (patch.unlisted !== undefined) u.unlisted = patch.unlisted;
  if (patch.siteUrl !== undefined) u.siteUrl = patch.siteUrl || null;
  if (patch.contactEmail !== undefined) u.contactEmail = patch.contactEmail || null;
  if (patch.contactPhone !== undefined) u.contactPhone = patch.contactPhone || null;
  if (patch.locations !== undefined) u.locations = OrgLocationsSchema.parse(patch.locations);
  if (patch.description !== undefined) u.description = patch.description;
  if (patch.crawlEnabled !== undefined) u.crawlEnabled = patch.crawlEnabled;
  if (patch.crawlListUrl !== undefined) u.crawlListUrl = patch.crawlListUrl || null;
  if (patch.sitePrompt !== undefined) u.sitePrompt = patch.sitePrompt || null;
  if (patch.allowedServices !== undefined)
    u.allowedServices = patch.allowedServices.length ? (patch.allowedServices as (typeof orgs.$inferInsert)['allowedServices']) : null;
  if (patch.crawlIntervalHours !== undefined) u.crawlIntervalHours = Math.max(1, Math.trunc(patch.crawlIntervalHours));
  if (Object.keys(u).length) await d.update(orgs).set(u).where(eq(orgs.id, id));
}

/** Store the (already EXIF-stripped) logo in R2 under `org/…`, drop the old one. */
export async function setOrgLogo(id: string, bytes: ArrayBuffer): Promise<string> {
  const d = adb();
  const [row] = await d.select({ logoKey: orgs.logoKey }).from(orgs).where(eq(orgs.id, id)).limit(1);
  if (!row) throw new Error('unknown agency');
  const key = `org/${id}/${crypto.randomUUID()}`;
  await mediaBucket().put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await d.update(orgs).set({ logoKey: key }).where(eq(orgs.id, id));
  if (row.logoKey) await mediaBucket().delete(row.logoKey).catch(() => {});
  return key;
}

/** Move a profile into (or out of, orgId=null) an agency's roster. */
export async function assignProfileToOrg(profileId: string, orgId: string | null): Promise<void> {
  await adb().update(profiles).set({ orgId }).where(eq(profiles.id, profileId));
}

/**
 * Delete an org (Pre-signups cleanup for a consent signup that never became a
 * real roster). REFUSES if the org already owns profiles — a real agency is
 * managed under /admin/organizations, not deleted from a lead list. Otherwise
 * drops its import jobs, the org, and its login-less placeholder `agency`
 * account (created together in createOrg; nothing else references it once the
 * profile guard passes).
 */
export async function deleteOrg(id: string): Promise<void> {
  const d = adb();
  const [org] = await d.select({ accountId: orgs.accountId }).from(orgs).where(eq(orgs.id, id)).limit(1);
  if (!org) return; // already gone — idempotent
  const [{ n }] = await d.select({ n: count() }).from(profiles).where(eq(profiles.orgId, id));
  if (n > 0) throw new Error('This agency already has profiles — manage it under Agencies instead of deleting it here.');
  await d.delete(importJobs).where(eq(importJobs.orgId, id));
  await d.delete(orgs).where(eq(orgs.id, id));
  if (org.accountId) await d.delete(accounts).where(eq(accounts.id, org.accountId));
}
