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
import { and, eq, ne, sql } from 'drizzle-orm';
import { supabaseServer } from '@/lib/supabase';
import { requestDb, type Db } from '@/db/client';
import { accounts, media, profiles } from '@/db/schema';
import { mediaUrl } from '@/app/data/db/profiles';
import { pushoverAdmins } from '@/lib/pushover';
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
      idVerification: accounts.idVerification,
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
    // A soft-deleted profile (GDPR approval, lifecycle law) must not ride the
    // session — without this filter the owner still saw her whole profile in
    // the dashboard after the deletion was approved.
    .leftJoin(profiles, and(eq(profiles.accountId, accounts.id), ne(profiles.state, 'deleted')))
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
    idVerification: row.idVerification,
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
        // Surface the assurance level so the admin gate can require aal2 (MFA).
        if (session && typeof claims.aal === 'string') session.aal = claims.aal;
      }
    }
    // Bridge a just-happened client→advertiser switch across the DB read lag
    // (Hyperdrive/pooler can serve the pre-switch accounts row for a while). The
    // switch action sets this short-lived cookie; honor it as advertiser until
    // the DB catches up. client→advertiser ONLY — never admin, so it can't
    // escalate (becoming an advertiser is self-service anyway).
    if (session && session.role === 'client' && /(?:^|;\s*)became_advertiser=1(?:;|$)/.test(cookieKey)) {
      session.role = 'advertiser';
    }
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      sessionCache.delete(sessionCache.keys().next().value!); // drop oldest
    }
    sessionCache.set(cookieKey, { session, exp: Date.now() + SESSION_TTL_MS });
    return session;
  },

  async register(ctx, { email, password, role, displayName }) {
    const supabase = supabaseServer(ctx);
    const origin = new URL(ctx.request.url).origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // The 0002 trigger whitelists + copies this into app_metadata and
        // creates the accounts row — no service key in the signup path. It also
        // reads display_name here (falls back to the email local-part), so the
        // pre-launch "working name" seeds accounts.display_name.
        data: { account_type: role, ...(displayName ? { display_name: displayName } : {}) },
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    });
    if (error) {
      // With "Confirm email" OFF, an existing email ERRORS (no anti-enumeration
      // obfuscation) — surface it as the same "account already exists" signal
      // (#13) instead of a raw error, so the modal shows reset/support.
      if (/already registered|already exists|user_already_exists/i.test(`${error.code ?? ''} ${error.message}`)) {
        return { session: null, needsConfirmation: false, emailExists: true };
      }
      throw new Error(error.message);
    }
    // Supabase obfuscates a signup on an EXISTING email (anti-enumeration) by
    // returning a user with an empty `identities` array and no session (this is
    // the "Confirm email" ON path). The owner wants a clear "account already
    // exists" message (#13), so surface it.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { session: null, needsConfirmation: false, emailExists: true };
    }
    // New account on the platform → ping the admin team (fire-and-forget).
    if (data.user) {
      // IDs only to Pushover (US processor, SECURITY.md) — never the email.
      if (role === 'advertiser') pushoverAdmins('advertiser_registered', 'New advertiser 🎉', `account ${data.user.id} registered as advertiser`);
      else pushoverAdmins('client_registered', 'New client', `account ${data.user.id} registered as client`);
    }
    // Confirmation ON → user exists but no session until the email link.
    if (!data.session || !data.user) return { session: null, needsConfirmation: true };
    return { session: await identity(data.user.id, data.user.email), needsConfirmation: false };
  },

  async changeEmail(ctx, { email }) {
    const supabase = supabaseServer(ctx);
    const origin = new URL(ctx.request.url).origin;
    // Supabase emails the NEW address a confirmation; the change lands only once
    // that link is followed → /auth/confirm exchanges it into the session.
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${origin}/auth/confirm?next=/account/settings/` },
    );
    if (error) {
      console.error('[session] changeEmail:', error.code, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  async changePassword(ctx, { currentPassword, newPassword }) {
    const supabase = supabaseServer(ctx);
    // Re-verify the current password before allowing the change (Supabase has no
    // "reauthenticate with password" primitive — a sign-in check is the guard).
    const { data: who } = await supabase.auth.getUser();
    const emailAddr = who.user?.email;
    if (!emailAddr) return { ok: false, error: 'not signed in' };
    const { error: reauth } = await supabase.auth.signInWithPassword({ email: emailAddr, password: currentPassword });
    if (reauth) return { ok: false, error: 'wrong_current_password' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      console.error('[session] changePassword:', error.code, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
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
    // 'global' revokes the refresh token server-side (not just this device's
    // cookie) — an explicit logout should kill a captured/stolen token too.
    // Best-effort: if the revoke call fails, still clear the local cookies.
    try {
      await supabaseServer(ctx).auth.signOut({ scope: 'global' });
    } catch {
      await supabaseServer(ctx).auth.signOut({ scope: 'local' });
    }
  },
};
