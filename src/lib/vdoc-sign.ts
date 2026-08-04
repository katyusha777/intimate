/**
 * Short-TTL signed URLs for verification-doc reads (hard rule 3). Standalone
 * (only cloudflare:workers for the secret) so it's unit-testable — the admin lib
 * re-exports the query/read half. Signature = HMAC-SHA256(id.exp) with a Worker
 * secret; the /admin wall + aal2 still gate the route, this adds time-boxing and
 * defence-in-depth. Server-only.
 */
import { env } from 'cloudflare:workers';

const TTL_MS = 5 * 60_000;
const secret = (): string =>
  (env as unknown as { VDOC_SIGNING_SECRET?: string }).VDOC_SIGNING_SECRET ?? 'dev-insecure-vdoc-secret';

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
  return expected.length === sig.length && expected === sig;
}
