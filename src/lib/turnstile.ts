/**
 * Cloudflare Turnstile server-side verification (bot wall on registration —
 * SECURITY.md §5). The widget (client) mints a token; we verify it against the
 * siteverify endpoint with the Worker secret. Server-only.
 *
 * Enforcement is gated on the secret being configured: no TURNSTILE_SECRET_KEY
 * (local dev) → verification is skipped so signup still works.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** True when the token is a valid, unspent Turnstile response for our secret. */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteip?: string,
): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteip) body.append('remoteip', remoteip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Network failure to Cloudflare → fail closed (treat as unverified).
    return false;
  }
}
