/**
 * Public read seam for partner agencies (docs/API.md): the public
 * /{locale}/agencies/{slug} page + sitemap call THIS — never the admin
 * actions (admin fence). Server path only: `orgs` has zero browser grants;
 * reads run as app_server via Drizzle→Hyperdrive. Private business data
 * (contact, KvK, crawl config) is deliberately NOT projected.
 */
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { orgs } from '@/db/schema';

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
