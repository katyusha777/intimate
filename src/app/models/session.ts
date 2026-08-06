/**
 * Session domain model (docs/API.md seam). The interface is the contract —
 * implemented by the Supabase Auth backend (data/supabase/session.ts):
 * @supabase/ssr cookie sessions, JWTs verified locally via getClaims().
 */
import { z } from 'zod';
import { ACCOUNT_TYPES, ADMIN_ROLES, PROFILE_STATES } from '@/lib/taxonomy';

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
  /** Admin sub-role (ADMIN.md §1). Present only when role === 'admin'. */
  adminRole: z.enum(ADMIN_ROLES).optional(),
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
  ): Promise<{ session: Session | null; needsConfirmation: boolean }>;
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
