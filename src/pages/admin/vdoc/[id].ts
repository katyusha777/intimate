/**
 * Verification-doc read (hard rule 3): the ONLY way an ID/selfie leaves the
 * private bucket. Admin-fenced (under /admin, so behind the Access wall + aal2),
 * additionally gated by a short-TTL HMAC signature, and EVERY read is written to
 * the audit log with the admin's identity. Never cached, never public.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAdmin, readVdoc, record } from '@/actions/admin/lib';
import { verifyVdoc } from '@/lib/vdoc-sign';

const forbid = () => new Response('forbidden', { status: 403 });

export const GET: APIRoute = async (ctx) => {
  const session = await getAdmin(ctx);
  if (!session) return forbid();

  const id = ctx.params.id ?? '';
  const exp = ctx.url.searchParams.get('exp') ?? '';
  const sig = ctx.url.searchParams.get('sig') ?? '';
  if (!(await verifyVdoc(id, exp, sig))) return forbid();

  const doc = await readVdoc(id);
  if (!doc) return new Response('not found', { status: 404 });

  // The read itself is the audited event (not just the reveal click).
  await record(session, { action: 'verification_doc_viewed', entityType: 'account', entityId: doc.accountId });

  const bucket = (env as unknown as { VERIFICATION: R2Bucket }).VERIFICATION;
  const obj = await bucket.get(doc.r2Key);
  if (!obj) return new Response('gone', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Toxic waste — never store anywhere.
      'cache-control': 'no-store, private',
      'referrer-policy': 'no-referrer',
    },
  });
};
