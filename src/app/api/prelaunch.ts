/**
 * Pre-launch leads seam (docs/API.md): professionals who pre-register on the
 * intimate.nl landing. Server path only — `prelaunch_leads` has zero browser
 * grants. The table (and this module) retires at launch.
 */
import { env } from 'cloudflare:workers';
import { desc, eq } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { prelaunchLeads } from '@/db/schema';

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

/** Upsert a landing lead and return its id. The id doubles as the pre-signup
 *  UPLOAD capability (httponly `psl` cookie), so a returning professional (same
 *  email) keeps the SAME photo folder instead of starting a second one. */
export async function upsertPrelaunchLeadReturningId(i: {
  name: string;
  email: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
  kind?: string;
  locale: string;
}): Promise<string> {
  const [row] = await db()
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
    // Re-submit (she may add a handle) refreshes the contacts and returns the id.
    .onConflictDoUpdate({
      target: prelaunchLeads.email,
      set: {
        name: i.name,
        phone: i.phone || null,
        whatsapp: i.whatsapp || null,
        telegram: i.telegram || null,
        kind: i.kind || null,
        locale: i.locale,
      },
    })
    .returning({ id: prelaunchLeads.id });
  return row.id;
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
