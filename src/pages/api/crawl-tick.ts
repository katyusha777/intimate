/**
 * Agency-crawl cron tick (ADMIN.md §8). The cron worker (workers/purge/ — it
 * owns ALL cron seams) POSTs here every 5 minutes with the shared secret, same
 * seam as /api/purge: the work runs with the main worker's DB/R2/Images
 * bindings. One tick = re-crawl at most one stale crawl-enabled agency +
 * process up to two queued import jobs (app/data/db/crawl.ts bounds the work).
 * Secret-guarded, fails closed when unset; never cached.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { crawlTick } from '@/app/api/crawl';
import { timingSafeEqual } from '@/lib/vdoc-sign';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const secret = (env as unknown as Record<string, string>).PURGE_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) return new Response('forbidden', { status: 403 });

  const result = await crawlTick();
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
