/**
 * Session domain model (docs/API.md seam). The interface is the contract —
 * implemented by the Supabase Auth backend (data/supabase/session.ts):
 * @supabase/ssr cookie sessions, JWTs verified locally via getClaims().
 */
import { z } from 'zod';
import { ACCOUNT_TYPES, ADMIN_ROLES, PROFILE_STATES, VERIFICATION_STATES } from '@/lib/taxonomy';

export const SessionSchema = z.object({
  /** accounts.id = auth.users.id — the identity every table keys on. */
  accountId: z.string(),
  email: z.string().email(),
  role: z.enum(ACCOUNT_TYPES),
  /** Display name (advertiser: profile name; else accounts.display_name). */
  name: z.string().min(1),
  /** Linked public profile — advertisers only (absent until one exists). */
  profileId: z.string().optional(),
  profileSlug: z.string().optional(),
  /** First approved public photo (served URL) — the avatar everywhere. */
  avatarUrl: z.string().optional(),
  /** Lifecycle state of the linked profile — gates "view public profile"
   *  (only 'live' has a public page) and the pause control. Absent until one exists. */
  profileState: z.enum(PROFILE_STATES).optional(),
  /** ID-verification state (advertisers) — rides the identity query so layouts
   *  don't pay a separate accounts read per render; lags ≤60s via the session
   *  memo, same class as name/avatar. */
  idVerification: z.enum(VERIFICATION_STATES).optional(),
  /** Admin sub-role (ADMIN.md §1). Present only when role === 'admin'. */
  adminRole: z.enum(ADMIN_ROLES).optional(),
  /** JWT assurance level ('aal1' | 'aal2') — 'aal2' means MFA was completed.
   *  Gates /admin when ADMIN_REQUIRE_AAL2 is enabled (ADMIN.md §1). */
  aal: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Minimal cookie jar contract — satisfied by Astro.cookies AND the actions context. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    opts?: {
      path?: string;
      maxAge?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
    },
  ): void;
  delete(name: string, opts?: { path?: string }): void;
}

/**
 * What every call site already has: the Astro global on pages/layouts, the
 * action context in actions. Session cookies are chunked — the raw request
 * header is required, a get-by-name jar is not enough.
 */
export interface AuthCtx {
  request: Request;
  cookies: CookieJar;
}

export interface SessionApi {
  /** Verified session from the request cookies (JWT checked), or null. */
  current(ctx: AuthCtx): Promise<Session | null>;
  /**
   * Sign up with email + password. When email confirmation is required the
   * user gets a mail and NO session yet — the modal shows "check your inbox".
   */
  register(
    ctx: AuthCtx,
    input: { email: string; password: string; role: 'advertiser' | 'client' },
  ): Promise<{ session: Session | null; needsConfirmation: boolean; emailExists?: boolean }>;
  /** Change the signed-in user's email — sends a confirmation to the NEW address;
   *  the change only takes effect once that link is clicked. */
  changeEmail(ctx: AuthCtx, input: { email: string }): Promise<{ ok: boolean; error?: string }>;
  /** Change the signed-in user's password after re-verifying the current one. */
  changePassword(
    ctx: AuthCtx,
    input: { currentPassword: string; newPassword: string },
  ): Promise<{ ok: boolean; error?: string }>;
  /** Password sign-in; null = bad credentials (or unconfirmed email). */
  signIn(ctx: AuthCtx, input: { email: string; password: string }): Promise<Session | null>;
  /**
   * Email a password-reset link (recovery). Always resolves without revealing
   * whether the address exists (anti-enumeration). The link lands on
   * /auth/confirm?type=recovery&next=/auth/reset → a recovery session → /auth/reset.
   */
  requestPasswordReset(ctx: AuthCtx, input: { email: string }): Promise<void>;
  /** Set a new password for the current (recovery) session. false = no/expired session. */
  setPassword(ctx: AuthCtx, input: { password: string }): Promise<boolean>;
  signOut(ctx: AuthCtx): Promise<void>;
}
