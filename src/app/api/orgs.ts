/**
 * Public seam for partner agencies (docs/API.md): the public
 * /{locale}/agencies/{slug} page + sitemap call THIS — never the admin
 * actions (admin fence). Server path only: `orgs` has zero browser grants;
 * everything runs as app_server via Drizzle→Hyperdrive. Private business data
 * (contact, KvK, crawl config) is deliberately NOT projected.
 *
 * Also holds org CREATION (createOrg + the §12.7 consent path): the public
 * /agencies consent form and the admin console both create orgs, and the
 * admin fence is one-directional — admin may import from here, nothing
 * imports from admin.
 */
import { env } from 'cloudflare:workers';
import { eq, or } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { accounts, orgs } from '@/db/schema';
import { slugifyBase } from '@/lib/slug';
import type { CitySlug } from '@/lib/taxonomy';

export interface PublicAgency {
  id: string;
  name: string;
  slug: string;
  city: string;
  verified: boolean;
  description: string;
  logoUrl?: string;
  siteUrl?: string;
  createdAt: string;
}

const db = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

const toPublic = (r: typeof orgs.$inferSelect): PublicAgency => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  city: r.city,
  verified: r.verified,
  description: r.description,
  logoUrl: r.logoKey ? `/media/${r.logoKey}` : undefined,
  siteUrl: r.siteUrl ?? undefined,
  createdAt: r.createdAt.toISOString(),
});

export async function agencyBySlug(slug: string): Promise<PublicAgency | null> {
  const [row] = await db().select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  return row ? toPublic(row) : null;
}

/** All agencies (sitemap + any future index page). */
export async function listAgencies(): Promise<PublicAgency[]> {
  return (await db().select().from(orgs)).map(toPublic);
}

/** `Elite Escorts` → `elite-escorts`, deduped against existing org slugs. */
async function uniqueOrgSlug(d: Db, name: string): Promise<string> {
  const base = slugifyBase(name, 'agency');
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await d.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, candidate)).limit(1);
    if (!hit.length) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface CreateOrgInput {
  name: string;
  city: CitySlug;
  kvk?: string;
  siteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  description?: string;
  crawlEnabled?: boolean;
  crawlListUrl?: string;
}

/** Create the org + its placeholder `agency` account (no login — upgradeable). */
export async function createOrg(input: CreateOrgInput): Promise<string> {
  const d = db();
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId, // NOT an auth.users id — this account cannot log in (yet)
    accountType: 'agency',
    displayName: input.name,
    // NO email: a placeholder agency account has no login, so it needs no
    // email identity — and the contact address lives on orgs.contact_email.
    // Writing it here would squat the accounts.email UNIQUE index: the public
    // consent form (anonymous) reaches createOrg, so an attacker could pre-seed
    // a victim's email and block their later Supabase signup (the signup
    // trigger's ON CONFLICT is on id, not email → unique_violation aborts it).
    email: null,
  });
  const [row] = await d
    .insert(orgs)
    .values({
      accountId,
      name: input.name,
      slug: await uniqueOrgSlug(d, input.name),
      city: input.city,
      kvk: input.kvk || null,
      siteUrl: input.siteUrl || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      description: input.description ?? '',
      crawlEnabled: input.crawlEnabled ?? false,
      crawlListUrl: input.crawlListUrl || null,
    })
    .returning({ id: orgs.id });
  return row!.id;
}

/**
 * The §12.7 consent form (PRE-LAUNCH-GRANT-CARDONE.md) → org row (pending,
 * crawl off until the owner reviews) + consent record. A repeat submission
 * (same site or email) matches the existing row — no junk orgs, and the caller
 * still notifies (a re-submit is a buying signal).
 */
export async function joinFromConsent(i: {
  name: string;
  siteUrl: string;
  email: string;
  phone?: string;
  ip: string;
  locale: string;
}): Promise<{ existing: boolean }> {
  const d = db();
  const consent = { consentAt: new Date(), consentIp: i.ip, consentLocale: i.locale };
  const [hit] = await d
    .select({ id: orgs.id, consentAt: orgs.consentAt })
    .from(orgs)
    .where(or(eq(orgs.siteUrl, i.siteUrl), eq(orgs.contactEmail, i.email)))
    .limit(1);
  if (hit) {
    // Stamp consent ONLY if the row has none yet. The dedupe key includes the
    // PUBLIC siteUrl, so overwriting an existing consent record would let anyone
    // forge/corrupt another agency's §12.7 consent evidence (IP, timestamp).
    // First consent (admin-created row, or a fresh match) still records.
    if (!hit.consentAt) await d.update(orgs).set(consent).where(eq(orgs.id, hit.id));
    return { existing: true };
  }
  const id = await createOrg({
    name: i.name,
    city: 'amsterdam', // founding cohort is Amsterdam (§1); owner can reassign in /admin
    siteUrl: i.siteUrl,
    contactEmail: i.email,
    contactPhone: i.phone,
  });
  await d.update(orgs).set(consent).where(eq(orgs.id, id));
  return { existing: false };
}
