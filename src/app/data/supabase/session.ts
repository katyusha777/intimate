/**
 * Supabase Auth session backend (SUPABASE.md §2) — replaces the mock cookie.
 *
 * The one law: never authorize from getSession() — `getClaims()` verifies the
 * JWT (locally once the project runs asymmetric signing keys). Role comes from
 * `app_metadata.account_type` (server-stamped by the 0002 trigger); identity
 * details (display name, admin sub-role, linked profile) come from one
 * Drizzle query over accounts ⟕ profiles.
 */
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { supabaseServer } from '@/lib/supabase';
import { createDb, type Db } from '@/db/client';
import { accounts, profiles } from '@/db/schema';
import type { Session, SessionApi } from '@/app/models/session';
import { ACCOUNT_TYPES } from '@/lib/taxonomy';

// Fresh client per call — workerd forbids cross-request I/O reuse; Hyperdrive
// makes per-request connects cheap.
const db = (): Db => createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

/** accounts ⟕ profiles → the Session shape every surface consumes. */
async function identity(accountId: string, email: string | undefined): Promise<Session | null> {
  const rows = await db()
    .select({
      accountType: accounts.accountType,
      adminRole: accounts.adminRole,
      email: accounts.email,
      displayName: accounts.displayName,
      profileId: profiles.id,
      profileSlug: profiles.slug,
      profileName: profiles.name,
    })
    .from(accounts)
    .leftJoin(profiles, eq(profiles.accountId, accounts.id))
    .where(eq(accounts.id, accountId))
    .limit(1);
  const row = rows[0];
  if (!row) return null; // auth user without an accounts row — treat as signed out
  const mail = row.email ?? email ?? 'unknown@invalid';
  return {
    accountId,
    email: mail,
    role: row.accountType,
    name: row.profileName ?? row.displayName ?? mail.split('@')[0] ?? 'User',
    profileId: row.profileId ?? undefined,
    profileSlug: row.profileSlug ?? undefined,
    adminRole: row.adminRole ?? undefined,
  };
}

export const sessionApi: SessionApi = {
  async current(ctx) {
    const supabase = supabaseServer(ctx);
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    const claims = data.claims;
    // Claims gate cheaply (no DB) — the row query fills in the rest.
    const type = (claims.app_metadata as Record<string, unknown> | undefined)?.account_type;
    if (typeof type !== 'string' || !(ACCOUNT_TYPES as readonly string[]).includes(type)) return null;
    return identity(claims.sub, typeof claims.email === 'string' ? claims.email : undefined);
  },

  async register(ctx, { email, password, role }) {
    const supabase = supabaseServer(ctx);
    const origin = new URL(ctx.request.url).origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // The 0002 trigger whitelists + copies this into app_metadata and
        // creates the accounts row — no service key in the signup path.
        data: { account_type: role },
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    });
    if (error) throw new Error(error.message);
    // Confirmation ON → user exists but no session until the email link.
    if (!data.session || !data.user) return { session: null, needsConfirmation: true };
    return { session: await identity(data.user.id, data.user.email), needsConfirmation: false };
  },

  async signIn(ctx, { email, password }) {
    const supabase = supabaseServer(ctx);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      // Bad credentials are expected traffic; anything else deserves a log line.
      if (error && error.code !== 'invalid_credentials') console.error('[session] signIn failed:', error.code, error.message);
      return null;
    }
    return identity(data.user.id, data.user.email);
  },

  async signOut(ctx) {
    await supabaseServer(ctx).auth.signOut({ scope: 'local' });
  },
};
