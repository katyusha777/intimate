/**
 * Twilio Verify (SUPABASE.md / ARCHITECTURE §11) — proving a professional owns
 * a phone number as a *profile attribute*, not a login (that path is Supabase's
 * phone provider). Twilio owns the OTP lifecycle: we only start + check.
 *
 * Auth = the API key already in .dev.vars (SK.../secret) — never the account
 * auth token (that lives only in the Supabase dashboard). Verify v2 URLs carry
 * the Service SID, not the account SID, so API-key Basic auth is sufficient.
 */
import { env } from 'cloudflare:workers';

type TwilioEnv = { TWILIO_API_KEY_SID: string; TWILIO_API_KEY_SECRET: string; TWILIO_VERIFY_SERVICE_SID: string };

async function verify(path: 'Verifications' | 'VerificationCheck', body: Record<string, string>) {
  const e = env as unknown as TwilioEnv;
  const res = await fetch(`https://verify.twilio.com/v2/Services/${e.TWILIO_VERIFY_SERVICE_SID}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${e.TWILIO_API_KEY_SID}:${e.TWILIO_API_KEY_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`twilio ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ status: string }>;
}

/** Send an SMS code to `phone` (E.164). Throws on Twilio error. */
export const startPhoneVerify = (phone: string) => verify('Verifications', { To: phone, Channel: 'sms' });

/** True when `code` matches the pending verification for `phone`. */
export const checkPhoneVerify = (phone: string, code: string) =>
  verify('VerificationCheck', { To: phone, Code: code }).then((r) => r.status === 'approved');
