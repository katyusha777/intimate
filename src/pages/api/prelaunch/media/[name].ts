/**
 * Serve a pre-signup photo back to the professional who uploaded it — gated by
 * her `psl` cookie (lead id), never public, never edge-cached. Her photos aren't
 * on a profile yet, so the /media route's `pub/` gate (needs a media row) can't
 * serve them; this tiny route derives the full R2 key from her cookie + the
 * requested name, so she can only ever see her OWN folder. Retires at launch.
 */
import type { APIRoute } from 'astro';
import { getPresignupPhoto } from '@/lib/presignup-media';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const leadId = ctx.cookies.get('psl')?.value;
  if (!leadId) return new Response(null, { status: 403 });
  const bytes = await getPresignupPhoto(leadId, ctx.params.name ?? '');
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' },
  });
};
