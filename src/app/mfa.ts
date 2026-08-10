/**
 * Admin MFA (TOTP) — client-side helpers over supabase-js `auth.mfa` (SUPABASE.md
 * §2.3). Browser-only: the browser client reads the session from the (non-httpOnly)
 * auth cookie and drives enroll/challenge/verify; verifying upgrades the session to
 * `aal2`, which the admin gate (`requireAdmin`/`getAdmin`) checks once
 * `ADMIN_REQUIRE_AAL2=true`. Used by the settings card and the admin-login step-up.
 */
import { supabaseBrowser } from '@/lib/supabase';

export interface Enrollment {
  factorId: string;
  /** SVG data-URL — render straight into an <img src>. */
  qrCode: string;
  /** The base32 secret, for manual authenticator entry when the QR won't scan. */
  secret: string;
}

export interface MfaStatus {
  hasFactor: boolean;
  currentLevel: string | null;
  nextLevel: string | null;
}

/** Does this admin already have a verified TOTP factor, and where's the session AAL? */
export async function mfaStatus(): Promise<MfaStatus> {
  const supabase = supabaseBrowser();
  const [{ data: aal }, { data: factors }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  return {
    hasFactor: (factors?.totp?.length ?? 0) > 0,
    currentLevel: aal?.currentLevel ?? null,
    nextLevel: aal?.nextLevel ?? null,
  };
}

/** The verified TOTP factor id (for a login challenge), or null. */
export async function verifiedTotpFactorId(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.mfa.listFactors();
  return data?.totp?.[0]?.id ?? null;
}

/** Begin enrollment: returns the QR + secret to display. Clears any abandoned
 *  unverified factor first (Supabase rejects a second enroll otherwise). */
export async function startEnroll(): Promise<Enrollment> {
  const supabase = supabaseBrowser();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error || !data) throw new Error(error?.message ?? 'Could not start enrollment');
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Challenge + verify a 6-digit code against a factor. On success the session
 *  is upgraded to aal2 (and, for a fresh enrollment, the factor is activated). */
export async function verifyCode(factorId: string, code: string): Promise<void> {
  const supabase = supabaseBrowser();
  const { data: challenge, error: ce } = await supabase.auth.mfa.challenge({ factorId });
  if (ce || !challenge) throw new Error(ce?.message ?? 'Could not start the challenge');
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (error) throw new Error(error.message);
}

/** Remove every enrolled factor (disable 2FA). Requires an aal2 session. */
export async function disableMfa(): Promise<void> {
  const supabase = supabaseBrowser();
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of data?.all ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
}
