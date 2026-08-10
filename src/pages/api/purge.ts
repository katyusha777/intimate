/**
 * Retention-purge endpoint (SECURITY.md §8, hard rule 3). The standalone purge
 * cron worker (workers/purge/) POSTs here with the shared secret through its
 * Service Binding — the work runs here with the main worker's DB + R2 bindings
 * (the cron worker carries no DB driver, same seam as /api/cache/urls + warm).
 * Secret-guarded, fails closed when unset; never cached.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requestDb } from '@/db/client';
import { runRetentionPurge } from '@/lib/purge';
import { timingSafeEqual } from '@/lib/vdoc-sign';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const secret = (env as unknown as Record<string, string>).PURGE_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) return new Response('forbidden', { status: 403 });

  const d = requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
  const verificationBucket = (env as unknown as { VERIFICATION: R2Bucket }).VERIFICATION;
  const result = await runRetentionPurge(d, verificationBucket);
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
