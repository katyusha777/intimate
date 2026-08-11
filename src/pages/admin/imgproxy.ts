/**
 * Admin-only preview proxy for the agency import test (ADMIN.md §8): agency
 * sites send Cross-Origin-Resource-Policy: same-origin, so their photos can't
 * be hotlinked into the admin — this fetches server-side (CORP is a browser
 * rule) and serves same-origin, shrunk via the Images binding. Session-gated,
 * never cached, nothing stored — the real import path (crawl.ts) owns
 * persistence + EXIF stripping.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAdmin } from '@/actions/admin/lib';

export const prerender = false;

const images = () => (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;
const BAD = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export const GET: APIRoute = async (ctx) => {
  if (!(await getAdmin(ctx))) return BAD(403);
  let u: URL;
  try {
    u = new URL(ctx.url.searchParams.get('u') ?? '');
  } catch {
    return BAD(400);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return BAD(400);
  if (/^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) return BAD(400);

  const res = await fetch(u.href, { headers: { accept: 'image/*' } });
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return BAD(502);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 15_000_000) return BAD(502);

  const IMAGES = images();
  if (IMAGES) {
    try {
      const out = await IMAGES.input(new Response(buf).body!)
        .transform({ width: 480 })
        .output({ format: 'image/webp', quality: 75 });
      const r = out.response();
      return new Response(r.body, {
        headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' },
      });
    } catch {
      /* transform hiccup → serve the original below */
    }
  }
  return new Response(buf, {
    headers: { 'content-type': res.headers.get('content-type')!, 'cache-control': 'private, no-store' },
  });
};
