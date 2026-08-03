/**
 * Admin server core (docs/ADMIN.md §1, §0.3): the role guard, the audit log,
 * and queue claims. Lives inside the admin fence. In prod the guard also
 * asserts Cloudflare Access + Supabase aal2 (MFA) and the stores are Postgres
 * with trigger-based audit; here they're mock KV — the seam swap.
 */
import { env } from 'cloudflare:workers';
import { ActionError } from 'astro:actions';
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
const now = () => new Date().toISOString();
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
  if (allowed && session.adminRole !== 'super' && !allowed.includes(session.adminRole)) {
    throw new ActionError({ code: 'FORBIDDEN', message: 'insufficient admin role' });
  }
  return session;
}

/** Non-throwing check for pages that render their own "not authorized" state. */
export async function getAdmin(context: AdminCtx): Promise<Session | null> {
  const session = await sessionApi.current(context);
  return session && session.role === 'admin' && session.adminRole ? session : null;
}

// --- Audit log (append-only; every admin action + sensitive read) ---------
const AUDIT_KEY = 'admin:audit';
const AUDIT_CAP = 2000;

export async function record(
  session: Session,
  entry: { action: AdminAction; entityType: string; entityId: string; reason?: string; meta?: Record<string, string> },
): Promise<void> {
  const raw = await kv()?.get(AUDIT_KEY);
  let list: AuditEntry[] = [];
  try {
    list = raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    list = [];
  }
  list.push({
    id: rid(),
    at: now(),
    adminEmail: session.email,
    adminRole: session.adminRole!,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason,
    meta: entry.meta,
  });
  if (list.length > AUDIT_CAP) list = list.slice(-AUDIT_CAP);
  await kv()?.put(AUDIT_KEY, JSON.stringify(list));
}

export interface AuditFilter {
  adminEmail?: string;
  action?: string;
  entityType?: string;
}
export async function listAudit(filter: AuditFilter = {}): Promise<AuditEntry[]> {
  const raw = await kv()?.get(AUDIT_KEY);
  let list: AuditEntry[] = [];
  try {
    list = raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    list = [];
  }
  return list
    .filter(
      (e) =>
        (!filter.adminEmail || e.adminEmail === filter.adminEmail) &&
        (!filter.action || e.action === filter.action) &&
        (!filter.entityType || e.entityType === filter.entityType),
    )
    .reverse();
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
