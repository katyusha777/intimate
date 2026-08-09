/**
 * Admin server core (docs/ADMIN.md §1, §0.3): the role guard, the audit log
 * (Postgres, trigger-guarded append-only), and queue claims (ephemeral KV soft
 * locks). Lives inside the admin fence. aal2 (MFA) assertion is implemented but
 * STAGED OFF (ADMIN_REQUIRE_AAL2) so it can't lock out an un-enrolled admin;
 * Cloudflare Access is the edge wall in front (§1).
 */
import { env } from 'cloudflare:workers';
import { ActionError } from 'astro:actions';
import { and, desc, eq } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { accounts, auditLog, verificationDocs } from '@/db/schema';
import { sessionApi } from '@/app/api/session';
import type { Session } from '@/app/models/session';
import type { AdminAction, AdminRole } from '@/lib/taxonomy';
import type { AuditEntry, Claim } from './types';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}
const adb = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
const now = () => new Date().toISOString();

// aal2/MFA enforcement is STAGED OFF by default so it can't lock out an admin
// who hasn't enrolled MFA yet. Enable AFTER enrolling MFA on the admin
// account(s): set ADMIN_REQUIRE_AAL2=true (Worker var/secret). Cloudflare Access
// remains the edge wall in front of this (ADMIN.md §1).
const requireAal2 = (): boolean =>
  (env as unknown as Record<string, string | undefined>).ADMIN_REQUIRE_AAL2 === 'true';
const hasAal2 = (session: Session): boolean => session.aal === 'aal2';

/** Context shape shared by Astro pages (Astro.*) and action handlers. */
export type AdminCtx = Parameters<typeof sessionApi.current>[0];

/**
 * The admin gate. `super` can do anything; otherwise the adminRole must be in
 * `allowed`. Real security adds the CF Access + aal2 assertions here (§1).
 */
export async function requireAdmin(context: AdminCtx, allowed?: AdminRole[]): Promise<Session> {
  const session = await sessionApi.current(context);
  if (!session || session.role !== 'admin' || !session.adminRole) {
    throw new ActionError({ code: 'UNAUTHORIZED', message: 'admin only' });
  }
  if (requireAal2() && !hasAal2(session)) {
    throw new ActionError({ code: 'FORBIDDEN', message: 'mfa required' });
  }
  if (allowed && session.adminRole !== 'super' && !allowed.includes(session.adminRole)) {
    throw new ActionError({ code: 'FORBIDDEN', message: 'insufficient admin role' });
  }
  return session;
}

/** Non-throwing check for pages that render their own "not authorized" state. */
export async function getAdmin(context: AdminCtx): Promise<Session | null> {
  const session = await sessionApi.current(context);
  if (!session || session.role !== 'admin' || !session.adminRole) return null;
  if (requireAal2() && !hasAal2(session)) return null;
  return session;
}

/**
 * The platform OWNER — the only admin who sees /admin/danger (destructive
 * raw-data tools other admins must not reach). An email, not a role: `super`
 * is a team tier; owner is one person.
 */
export const OWNER_EMAIL = 'katyusha@intimate.nl';

export const isOwner = (session: Session | null): boolean =>
  !!session && session.email.toLowerCase() === OWNER_EMAIL;

/** Owner gate for destructive actions — admin AND the owner email, or throw. */
export async function requireOwner(context: AdminCtx): Promise<Session> {
  const session = await requireAdmin(context);
  if (!isOwner(session)) throw new ActionError({ code: 'FORBIDDEN', message: 'owner only' });
  return session;
}

// --- Audit log (append-only; every admin action + sensitive read) ---------
// Postgres `audit_log`, guarded append-only by the 0001 trigger (no role can
// rewrite history). admin_account_id keeps the actor even after user deletion.
const AUDIT_CAP = 2000;

export async function record(
  session: Session,
  entry: { action: AdminAction; entityType: string; entityId: string; reason?: string; meta?: Record<string, string> },
): Promise<void> {
  await adb().insert(auditLog).values({
    adminAccountId: session.accountId,
    adminEmail: session.email,
    adminRole: session.adminRole!,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason,
    meta: entry.meta,
  });
}

// --- Verification docs (hard rule 3): toxic-waste reads --------------------
// The signed-URL half (signVdocUrl / verifyVdoc) lives in lib/vdoc-sign.ts so it
// stays unit-testable; the DB half stays here (needs the admin db). Every read is
// audit-logged at the serve route (src/pages/admin/vdoc/[id].ts).

/** The R2 key + owning account for a doc id (serve route). */
export async function readVdoc(id: string): Promise<{ r2Key: string; accountId: string } | null> {
  const rows = await adb()
    .select({ r2Key: verificationDocs.r2Key, accountId: verificationDocs.accountId })
    .from(verificationDocs)
    .where(eq(verificationDocs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Doc ids submitted by an account (by email) — the review panel signs each. */
export async function verificationDocIdsFor(email: string): Promise<string[]> {
  const rows = await adb()
    .select({ id: verificationDocs.id })
    .from(verificationDocs)
    .innerJoin(accounts, eq(accounts.id, verificationDocs.accountId))
    .where(eq(accounts.email, email));
  return rows.map((r) => r.id);
}

export interface AuditFilter {
  adminEmail?: string;
  action?: string;
  entityType?: string;
}
export async function listAudit(filter: AuditFilter = {}): Promise<AuditEntry[]> {
  const where = and(
    filter.adminEmail ? eq(auditLog.adminEmail, filter.adminEmail) : undefined,
    filter.action ? eq(auditLog.action, filter.action as AdminAction) : undefined,
    filter.entityType ? eq(auditLog.entityType, filter.entityType) : undefined,
  );
  const rows = await adb().select().from(auditLog).where(where).orderBy(desc(auditLog.at)).limit(AUDIT_CAP);
  return rows.map(
    (r): AuditEntry => ({
      id: r.id,
      at: r.at.toISOString(),
      adminEmail: r.adminEmail,
      adminRole: r.adminRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason ?? undefined,
      meta: r.meta ?? undefined,
    }),
  );
}

// --- Claims (soft locks so two admins never work one item) ----------------
const CLAIMS_KEY = 'admin:claims';
const CLAIM_TTL_MS = 10 * 60 * 1000;

async function readClaims(): Promise<Record<string, Claim>> {
  const raw = await kv()?.get(CLAIMS_KEY);
  try {
    return raw ? (JSON.parse(raw) as Record<string, Claim>) : {};
  } catch {
    return {};
  }
}
/** Active claims only (stale ones past the TTL are ignored). */
export async function getClaims(): Promise<Record<string, Claim>> {
  const all = await readClaims();
  const cutoff = Date.now() - CLAIM_TTL_MS;
  const active: Record<string, Claim> = {};
  for (const [k, c] of Object.entries(all)) {
    if (new Date(c.at).getTime() >= cutoff) active[k] = c;
  }
  return active;
}
export async function claimItem(session: Session, itemKey: string): Promise<void> {
  const all = await readClaims();
  all[itemKey] = { by: session.email, at: now() };
  await kv()?.put(CLAIMS_KEY, JSON.stringify(all));
}
export async function releaseItem(session: Session, itemKey: string): Promise<void> {
  const all = await readClaims();
  if (all[itemKey]?.by === session.email) {
    delete all[itemKey];
    await kv()?.put(CLAIMS_KEY, JSON.stringify(all));
  }
}
