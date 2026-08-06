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
import { eq, sql } from 'drizzle-orm';
import { supabaseServer } from '@/lib/supabase';
import { requestDb, type Db } from '@/db/client';
import { accounts, media, profiles } from '@/db/schema';
import { mediaUrl } from '@/app/data/db/profiles';
import type { Session, SessionApi } from '@/app/models/session';
import { ACCOUNT_TYPES } from '@/lib/taxonomy';

// Fresh client per call — workerd forbids cross-request I/O reuse; Hyperdrive
// makes per-request connects cheap.
const db = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

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
      profileState: profiles.state,
      profileName: profiles.name,
      // Avatar = first approved public photo — scalar subquery so the whole
      // identity is ONE round trip (this runs on every SSR request).
      avatarKey: sql<string | null>`(
        select ${media.imageKey} from ${media}
        where ${media.profileId} = ${profiles.id}
          and ${media.state} = 'approved' and ${media.isPrivate} = false
        order by ${media.position} asc limit 1)`,
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
    profileState: row.profileState ?? undefined,
    avatarUrl: row.avatarKey ? mediaUrl(row.avatarKey) : undefined,
    adminRole: row.adminRole ?? undefined,
  };
}

// Isolate-local session memo: every SSR request pays getClaims (JWKS fetch on
// a fresh per-request client) + the identity query — ~150-300ms of the page's
// TTFB. Same Cookie header within 60s → same session; plain data, no I/O
// objects, so module scope is safe. Sign-out changes cookies → instant miss;
// name/avatar edits lag ≤60s. Authorization stays exact: the token IS the key.
const SESSION_TTL_MS = 60_000;
const SESSION_CACHE_MAX = 200;
const sessionCache = new Map<string, { session: Session | null; exp: number }>();

export const sessionApi: SessionApi = {
  async current(ctx) {
    const cookieKey = ctx.request.headers.get('Cookie') ?? '';
    if (!cookieKey) return null; // no cookies → no session, skip all I/O
    const hit = sessionCache.get(cookieKey);
    if (hit && hit.exp > Date.now()) return hit.session;

    const supabase = supabaseServer(ctx);
    const { data, error } = await supabase.auth.getClaims();
    let session: Session | null = null;
    if (!error && data?.claims?.sub) {
      const claims = data.claims;
      // Claims gate cheaply (no DB) — the row query fills in the rest.
      const type = (claims.app_metadata as Record<string, unknown> | undefined)?.account_type;
      if (typeof type === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(type)) {
        session = await identity(claims.sub, typeof claims.email === 'string' ? claims.email : undefined);
      }
    }
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      sessionCache.delete(sessionCache.keys().next().value!); // drop oldest
    }
    sessionCache.set(cookieKey, { session, exp: Date.now() + SESSION_TTL_MS });
    return session;
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

  async requestPasswordReset(ctx, { email }) {
    const supabase = supabaseServer(ctx);
    const origin = new URL(ctx.request.url).origin;
    // Recovery mail → /auth/confirm (verifyOtp type=recovery) → /auth/reset.
    // Errors are swallowed on purpose: never reveal whether the email exists.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=/auth/reset`,
    });
    if (error) console.error('[session] requestPasswordReset:', error.code, error.message);
  },

  async setPassword(ctx, { password }) {
    const supabase = supabaseServer(ctx);
    // Only works when the recovery session (set by /auth/confirm) is present.
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error || !data.user) {
      if (error) console.error('[session] setPassword:', error.code, error.message);
      return false;
    }
    return true;
  },

  async signOut(ctx) {
    await supabaseServer(ctx).auth.signOut({ scope: 'local' });
  },
};
