/**
 * Short-TTL signed URLs for verification-doc reads (hard rule 3). Standalone
 * (only cloudflare:workers for the secret) so it's unit-testable — the admin lib
 * re-exports the query/read half. Signature = HMAC-SHA256(id.exp) with a Worker
 * secret; the /admin wall + aal2 still gate the route, this adds time-boxing and
 * defence-in-depth. Server-only.
 */
import { env } from 'cloudflare:workers';

// 30 min: long enough for a real review sitting (a 5-min URL generated at page
// load expired mid-review → "forbidden"). Still time-boxed + admin-walled.
const TTL_MS = 30 * 60_000;
const secret = (): string => {
  const s = (env as unknown as { VDOC_SIGNING_SECRET?: string }).VDOC_SIGNING_SECRET;
  if (s) return s;
  // Fail closed in prod: without the secret, toxic-waste URLs would be forgeable
  // by anyone who read the repo (hard rule 3). The dev fallback exists only so
  // local dev works.
  if (import.meta.env.PROD) throw new Error('VDOC_SIGNING_SECRET is unset — refusing to sign/verify with an insecure fallback');
  return 'dev-insecure-vdoc-secret';
};

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A short-TTL signed admin URL for a verification doc id (`nowMs` injectable for tests). */
export async function signVdocUrl(id: string, nowMs: number = Date.now()): Promise<string> {
  const exp = nowMs + TTL_MS;
  return `/admin/vdoc/${id}?exp=${exp}&sig=${await hmac(`${id}.${exp}`)}`;
}

/** Valid, unexpired signature for this doc id? */
export async function verifyVdoc(id: string, exp: string, sig: string, nowMs: number = Date.now()): Promise<boolean> {
  if (!/^\d+$/.test(exp) || Number(exp) < nowMs) return false;
  const expected = await hmac(`${id}.${exp}`);
  return timingSafeEqual(expected, sig);
}

/** Constant-time string compare (hex sigs): length check, then XOR-accumulate over char codes. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
