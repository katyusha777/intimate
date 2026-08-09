/**
 * Media delivery (DATA.md): serves profile photos from R2 through the edge
 * cache (Cache API) — no per-view delivery fee (unlike Cloudflare Images
 * storage).
 *
 * Key encodes visibility: `pub/<profileId>/<uuid>` is world-readable and
 * cached at the edge under a CANONICAL key (mediaCacheUrl — fixed origin +
 * path + validated ?v, never the raw request URL); `priv/…` is gated
 * per-thread and never cached. Optional `?v=thumb|card|full` resizes via the
 * IMAGES transform binding — the transform runs once per canonical URL, not
 * per view (the cached copy is the transformed bytes). If the binding is
 * unavailable (local dev, Transformations off) the original bytes serve; a
 * FAILED transform serves the original uncached (no-store) so one hiccup
 * can't pin full-size bytes under a variant URL.
 *
 * Takedown vs cache — the media⋈profiles gate runs BEFORE the cache lookup:
 * a missing/rejected media row (removePhoto, mediaReject, GDPR wipe) or a
 * non-live profile blocks serving on the next request, globally, within
 * DB-read freshness (Hyperdrive reads can lag writes by minutes — see
 * memory/hyperdrive-read-cache-active); evictMediaCache at the takedown
 * sites makes the common case instant. Cached entries a gate blocks are
 * unreachable, so long retention is safe.
 * ponytail: the per-view gate SELECT is the known ceiling; drop it and purge
 * by URL (zone API token) if media QPS ever makes it matter.
 */
import type { APIRoute } from 'astro';
import { env, waitUntil } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { contacts, media, profiles } from '@/db/schema';
import { sessionApi } from '@/app/api/session';
import { VARIANT_WIDTH, edgeCache, mediaCacheUrl } from '@/lib/media-keys';

export const prerender = false;

const bucket = () => (env as unknown as { MEDIA: R2Bucket }).MEDIA;
const images = () => (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;
const db = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

/** May the requester see this private photo? Owner always; a granted client. */
async function canViewPrivate(ctx: Parameters<APIRoute>[0], profileId: string): Promise<boolean> {
  const session = await sessionApi.current(ctx);
  if (!session) return false;
  const d = db();
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

/** The owner of this profile, or any admin — may preview pub photos of a NOT-yet-live
 *  profile (her own draft/pending photos in the editor; admin in review). */
async function isOwnerOrAdmin(ctx: Parameters<APIRoute>[0], profileId: string): Promise<boolean> {
  const session = await sessionApi.current(ctx);
  if (!session) return false;
  if (session.adminRole) return true;
  const owner = await db()
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.accountId, session.accountId)))
    .limit(1);
  return owner.length > 0;
}

const GONE = () => new Response(null, { status: 410, headers: { 'Cache-Control': 'no-store' } });

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
    // THE takedown gate, one round trip: the media row (missing = removed by
    // removePhoto/GDPR; 'rejected' = mediaReject) AND the profile lifecycle.
    // Runs before the cache lookup so a takedown blocks even cached copies.
    const [row] = await db()
      .select({ profileState: profiles.state, mediaState: media.state })
      .from(media)
      .innerJoin(profiles, eq(profiles.id, media.profileId))
      .where(and(eq(media.profileId, profileId), eq(media.imageKey, key)))
      .limit(1);
    if (!row || row.mediaState === 'rejected') return GONE();
    if (row.profileState !== 'live') {
      // Not live. The OWNER (editing her photos) and admins may PREVIEW the
      // in-progress states — draft/pending_review/paused — so her own uploads
      // don't render broken before approval. TAKEDOWN states (blocked/deleted)
      // stay dark for EVERYONE incl. the owner, and the public always gets 410.
      const previewable =
        row.profileState === 'draft' ||
        row.profileState === 'pending_review' ||
        row.profileState === 'paused';
      if (!(previewable && (await isOwnerOrAdmin(ctx, profileId)))) return GONE();
      ownerPreview = true;
    }
  }

  // Edge cache (public + live only), keyed by the CANONICAL URL. Keys are
  // content-addressed UUIDs — bytes never change under a URL — and the gate
  // above owns takedown, so long retention is safe. A HIT skips R2 + the
  // Images transform (billed per run). Rewrap the hit: cache.match responses
  // have immutable headers, which would silently defeat the middleware's
  // security-header pass.
  const vParam = ctx.url.searchParams.get('v') ?? '';
  // hasOwn: ?v= is attacker-controlled; a plain lookup leaks prototype keys.
  const width = Object.hasOwn(VARIANT_WIDTH, vParam) ? VARIANT_WIDTH[vParam] : undefined;
  const cacheable = !isPrivate && !ownerPreview;
  const edge = edgeCache();
  const cacheUrl = mediaCacheUrl(key, vParam);
  if (cacheable && edge) {
    const hit = await edge.match(cacheUrl);
    if (hit) return new Response(hit.body, hit);
  }

  const obj = await bucket().get(key);
  if (!obj) return new Response(null, { status: 404 });

  const cacheControl = cacheable ? 'public, max-age=31536000, immutable' : 'private, no-store';
  const contentType = obj.httpMetadata?.contentType ?? 'image/jpeg';
  // Buffered, not streamed: the transform-failure fallback below re-serves the
  // same bytes, which a consumed stream can't.
  const buf = await obj.arrayBuffer();

  const store = (res: Response): Response => {
    // Set-Cookie guard mirrors page-cache.ts (SECURITY.md §5: cookies and
    // shared caches never meet) — unreachable today, cheap to keep true.
    if (!cacheable || !edge || res.headers.has('set-cookie')) return res;
    const copy = res.clone();
    copy.headers.set('x-cache', 'HIT'); // a later match self-identifies
    // Best-effort: a rejected put must never error the invocation, but DO log
    // it — a silent put no-op is indistinguishable from a cold cache.
    waitUntil(edge.put(cacheUrl, copy).catch((e) => console.warn('[media] cache.put failed:', (e as Error)?.message)));
    res.headers.set('x-cache', 'MISS');
    return res;
  };

  const IMAGES = images();
  // A variant was requested but can't be produced (no binding) — serve the
  // original UNCACHED, like the failed-transform branch below: full-size bytes
  // must never get pinned under a variant URL (edge: forever; browsers: a year).
  if (width && !IMAGES) {
    return new Response(buf, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    });
  }
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
      // Transform FAILED (transient binding error) — serve the original but
      // never cache it: caching would pin full-size bytes under the variant
      // URL for every viewer (edge) and for a year (browsers).
      return new Response(buf, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
      });
    }
  }
  return store(
    new Response(buf, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } }),
  );
};
