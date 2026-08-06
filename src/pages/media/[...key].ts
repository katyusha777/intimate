/**
 * Media delivery (DATA.md): serves profile photos from R2 through Cloudflare's
 * edge cache — no per-view delivery fee (unlike Cloudflare Images storage).
 *
 * Key encodes visibility: `pub/<profileId>/<uuid>` is world-readable and cached
 * hard at the edge (no DB hit on the hot path); `priv/…` is gated per-thread
 * and never cached. Optional `?v=thumb|card|full` resizes via the IMAGES
 * transform binding, cached per variant; if the binding is unavailable (local
 * dev, or Transformations not enabled on the zone) it falls back to the
 * original bytes — serving never breaks on a transform miss.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { contacts, profiles } from '@/db/schema';
import { sessionApi } from '@/app/api/session';

export const prerender = false;

const bucket = () => (env as unknown as { MEDIA: R2Bucket }).MEDIA;
const images = () => (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;

const VARIANT_WIDTH: Record<string, number> = { thumb: 200, card: 600, full: 1200 };

/** May the requester see this private photo? Owner always; a granted client. */
async function canViewPrivate(ctx: Parameters<APIRoute>[0], profileId: string): Promise<boolean> {
  const session = await sessionApi.current(ctx);
  if (!session) return false;
  const d = requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
  const owner = await d
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.accountId, session.accountId)))
    .limit(1);
  if (owner.length) return true;
  // A client she accepted (contacts.private_set_unlocked). No contacts row yet
  // (messaging still mock) → only the owner sees private photos, which is safe.
  const grant = await d
    .select({ ok: contacts.privateSetUnlocked })
    .from(contacts)
    .where(
      and(
        eq(contacts.profileId, profileId),
        eq(contacts.clientAccountId, session.accountId),
        eq(contacts.privateSetUnlocked, true),
      ),
    )
    .limit(1);
  return grant.length > 0;
}

export const GET: APIRoute = async (ctx) => {
  const key = ctx.params.key;
  if (!key || (!key.startsWith('pub/') && !key.startsWith('priv/'))) {
    return new Response(null, { status: 404 });
  }

  const isPrivate = key.startsWith('priv/');
  if (isPrivate) {
    const profileId = key.split('/')[1] ?? '';
    if (!(await canViewPrivate(ctx, profileId))) return new Response(null, { status: 403 });
  }

  const obj = await bucket().get(key);
  if (!obj) return new Response(null, { status: 404 });

  const cacheControl = isPrivate
    ? 'private, no-store'
    : 'public, max-age=31536000, immutable';
  const contentType = obj.httpMetadata?.contentType ?? 'image/jpeg';
  const buf = await obj.arrayBuffer();

  const width = VARIANT_WIDTH[ctx.url.searchParams.get('v') ?? ''];
  const IMAGES = images();
  if (width && IMAGES) {
    try {
      const result = await IMAGES.input(new Response(buf).body!)
        .transform({ width })
        .output({ format: 'image/webp' });
      const r = result.response();
      const headers = new Headers(r.headers);
      headers.set('Cache-Control', cacheControl);
      return new Response(r.body, { headers });
    } catch {
      // transform unavailable/failed → serve the original below.
    }
  }
  return new Response(buf, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } });
};
