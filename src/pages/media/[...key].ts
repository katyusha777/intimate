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

/** This profile's lifecycle state (null = no such profile). */
async function profileStateOf(profileId: string): Promise<string | null> {
  if (!profileId) return null;
  const d = requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
  const row = await d
    .select({ state: profiles.state })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return row[0]?.state ?? null;
}

/** The owner of this profile, or any admin — may preview pub photos of a NOT-yet-live
 *  profile (her own draft/pending photos in the editor; admin in review). */
async function isOwnerOrAdmin(ctx: Parameters<APIRoute>[0], profileId: string): Promise<boolean> {
  const session = await sessionApi.current(ctx);
  if (!session) return false;
  if (session.adminRole) return true;
  const d = requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
  const owner = await d
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.accountId, session.accountId)))
    .limit(1);
  return owner.length > 0;
}

export const GET: APIRoute = async (ctx) => {
  const key = ctx.params.key;
  if (!key || (!key.startsWith('pub/') && !key.startsWith('priv/'))) {
    return new Response(null, { status: 404 });
  }

  const isPrivate = key.startsWith('priv/');
  const profileId = key.split('/')[1] ?? '';
  // Owner-preview: her own not-yet-live photos serve to her (and admins) but are
  // never edge-cached (they change during editing and aren't public yet).
  let ownerPreview = false;
  if (isPrivate) {
    if (!(await canViewPrivate(ctx, profileId))) return new Response(null, { status: 403 });
  } else {
    const state = await profileStateOf(profileId);
    if (state !== 'live') {
      // Not live. The OWNER (editing her photos) and admins may PREVIEW the
      // in-progress states — draft/pending_review/paused — so her own uploads
      // don't render broken before approval. TAKEDOWN states (blocked/deleted)
      // stay dark for EVERYONE incl. the owner, and the public always gets 410.
      // ponytail: per-request profile lookup on the hot image path partly
      // defeats the edge cache; the real cache-eviction on takedown is
      // byte-deletion from R2 (handled in admin). Per-photo media.state
      // (rejected) not joined; see report.
      const previewable = state === 'draft' || state === 'pending_review' || state === 'paused';
      if (!(previewable && (await isOwnerOrAdmin(ctx, profileId)))) {
        return new Response(null, { status: 410, headers: { 'Cache-Control': 'no-store' } });
      }
      ownerPreview = true;
    }
  }

  const obj = await bucket().get(key);
  if (!obj) return new Response(null, { status: 404 });

  const cacheControl =
    isPrivate || ownerPreview
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
        // Without an explicit quality the binding emits near-lossless WebP
        // (a 600px card came out 477 KB — bigger than the JPEG original).
        .output({ format: 'image/webp', quality: 80 });
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
