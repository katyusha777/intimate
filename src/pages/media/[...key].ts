/**
 * Media delivery (DATA.md): serves profile photos from R2 through Cloudflare's
 * edge cache — no per-view delivery fee (unlike Cloudflare Images storage).
 *
 * Key encodes visibility: `pub/<profileId>/<uuid>` is world-readable and cached
 * at the edge (Cache API, per ?v variant); `priv/…` is gated per-thread and
 * never cached. Optional `?v=thumb|card|full` resizes via the IMAGES transform
 * binding — the transform runs once per URL, not per view (the cached copy is
 * the transformed bytes). If the binding is unavailable (local dev, or
 * Transformations not enabled on the zone) it falls back to the original
 * bytes — serving never breaks on a transform miss.
 *
 * Takedown vs cache: the profile-state gate runs BEFORE the cache lookup on
 * purpose — profile takedown (paused/blocked/deleted) goes dark on the next
 * request, no purge needed. Per-PHOTO takedown (removePhoto / mediaReject) is
 * R2 delete + evictMediaCache (media-keys.ts), bounded worst-case by the
 * cached copy's s-maxage hour.
 * ponytail: the per-view state SELECT is the known ceiling; drop it and purge
 * by URL (zone API token) if media QPS ever makes it matter.
 */
import type { APIRoute } from 'astro';
import { env, waitUntil } from 'cloudflare:workers';
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

  // Edge cache (public + live only): keys are content-addressed UUIDs — bytes
  // never change under a URL, so a long TTL is safe; the state gate above owns
  // takedown. Skips R2 + the Images transform (billed per run) on every HIT.
  const cacheable = !isPrivate && !ownerPreview;
  const edge = (globalThis.caches as unknown as { default?: Cache } | undefined)?.default;
  if (cacheable && edge) {
    const hit = await edge.match(ctx.request.url);
    if (hit) return hit;
  }

  const obj = await bucket().get(key);
  if (!obj) return new Response(null, { status: 404 });

  // s-maxage bounds the EDGE copy at an hour (browsers ignore it and keep the
  // immutable year): photo takedown = R2 delete + best-effort evictMediaCache,
  // and this TTL caps the window where neither reached a colo's cached copy.
  const cacheControl = cacheable
    ? 'public, max-age=31536000, s-maxage=3600, immutable'
    : 'private, no-store';
  const contentType = obj.httpMetadata?.contentType ?? 'image/jpeg';
  // Buffered, not streamed: the transform-failure fallback below re-serves the
  // same bytes, which a consumed stream can't.
  const buf = await obj.arrayBuffer();

  const store = (res: Response): Response => {
    if (!cacheable || !edge) return res;
    const copy = res.clone();
    copy.headers.set('x-cache', 'HIT'); // a later match self-identifies
    waitUntil(edge.put(ctx.request.url, copy));
    res.headers.set('x-cache', 'MISS');
    return res;
  };

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
      return store(new Response(r.body, { headers }));
    } catch {
      // transform unavailable/failed → serve the original below.
    }
  }
  return store(
    new Response(buf, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } }),
  );
};
