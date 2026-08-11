/**
 * Admin-only preview proxy for the agency import test (ADMIN.md §8): agency
 * sites send Cross-Origin-Resource-Policy: same-origin, so their photos can't
 * be hotlinked into the admin — this fetches server-side (CORP is a browser
 * rule) and serves same-origin, shrunk via the Images binding. Session-gated;
 * browser-cached for an hour (previews are immutable per URL — re-transforming
 * on every panel reload is billed waste); nothing stored — the real import
 * path (app/data/db/crawl.ts) owns persistence + EXIF stripping.
 */
import type { APIRoute } from 'astro';
import { getAdmin } from '@/actions/admin/lib';
import { fetchExternalImage, transformImage } from '@/lib/fetch-image';

export const prerender = false;

const BAD = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const CACHE = 'private, max-age=3600';

export const GET: APIRoute = async (ctx) => {
  if (!(await getAdmin(ctx))) return BAD(403);
  const img = await fetchExternalImage(ctx.url.searchParams.get('u') ?? '');
  if (!img) return BAD(502);
  const shrunk = await transformImage(img.bytes, { width: 480, format: 'image/webp', quality: 75 });
  if (shrunk) {
    return new Response(shrunk, { headers: { 'content-type': 'image/webp', 'cache-control': CACHE } });
  }
  // No binding / transform hiccup — the original serves (preview-only surface).
  return new Response(img.bytes, { headers: { 'content-type': img.contentType, 'cache-control': CACHE } });
};
