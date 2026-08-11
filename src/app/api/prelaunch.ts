/**
 * Pre-launch leads seam (docs/API.md): professionals who pre-register on the
 * intimate.nl landing. Server path only — `prelaunch_leads` has zero browser
 * grants. The table (and this module) retires at launch.
 */
import { env } from 'cloudflare:workers';
import { requestDb } from '@/db/client';
import { prelaunchLeads } from '@/db/schema';

const db = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

/** Duplicate email = idempotent success — no enumeration surface, nothing a
 *  phone-holding closer has to explain. */
export async function addPrelaunchLead(i: { name: string; email: string; phone?: string; locale: string }): Promise<void> {
  await db()
    .insert(prelaunchLeads)
    .values({ name: i.name, email: i.email, phone: i.phone || null, locale: i.locale })
    .onConflictDoNothing();
}
