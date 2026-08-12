/**
 * Pre-launch leads seam (docs/API.md): professionals who pre-register on the
 * intimate.nl landing. Server path only — `prelaunch_leads` has zero browser
 * grants. The table (and this module) retires at launch.
 */
import { env } from 'cloudflare:workers';
import { desc, eq, inArray } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { accounts, prelaunchLeads, profiles } from '@/db/schema';

const db = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

export type PrelaunchLead = typeof prelaunchLeads.$inferSelect;

/** Duplicate email = idempotent success — no enumeration surface, nothing a
 *  phone-holding closer has to explain. */
export async function addPrelaunchLead(i: {
  name: string;
  email: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  kind?: string;
  locale: string;
}): Promise<void> {
  await db()
    .insert(prelaunchLeads)
    .values({
      name: i.name,
      email: i.email,
      phone: i.phone || null,
      whatsapp: i.whatsapp || null,
      telegram: i.telegram || null,
      kind: i.kind || null,
      locale: i.locale,
    })
    .onConflictDoNothing();
}

/** Admin Pre-signups: which landing leads have already become a (draft) profile.
 *  An advertiser's passwordless join creates an account (same email) + her
 *  profile; match lead.email → account.email → profile so the closer can open it
 *  in the admin editor — and SEE who started building before launch (drafts
 *  don't reach the approval queue). Returns email → { id, state }. */
export async function profilesForLeadEmails(
  emails: string[],
): Promise<Map<string, { id: string; state: string }>> {
  if (emails.length === 0) return new Map();
  const rows = await db()
    .select({ email: accounts.email, id: profiles.id, state: profiles.state })
    .from(accounts)
    .innerJoin(profiles, eq(profiles.accountId, accounts.id))
    .where(inArray(accounts.email, emails));
  return new Map(rows.flatMap((r) => (r.email ? [[r.email, { id: r.id, state: r.state }] as const] : [])));
}

/** Admin read: newest first. Server-only surface (admin page). */
export async function listPrelaunchLeads(): Promise<PrelaunchLead[]> {
  return db().select().from(prelaunchLeads).orderBy(desc(prelaunchLeads.createdAt));
}

/** Admin: remove a landing lead (Pre-signups cleanup). */
export async function deletePrelaunchLead(id: string): Promise<void> {
  await db().delete(prelaunchLeads).where(eq(prelaunchLeads.id, id));
}

/** Admin: fix a landing lead's contact info (Pre-signups edit). */
export async function updatePrelaunchLead(id: string, patch: { name?: string; email?: string; phone?: string }): Promise<void> {
  const u: Partial<typeof prelaunchLeads.$inferInsert> = {};
  if (patch.name !== undefined) u.name = patch.name;
  if (patch.email !== undefined) u.email = patch.email;
  if (patch.phone !== undefined) u.phone = patch.phone || null;
  if (Object.keys(u).length) await db().update(prelaunchLeads).set(u).where(eq(prelaunchLeads.id, id));
}
