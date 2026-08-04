/**
 * Warm-URL list (docs/ARCHITECTURE §4). The GitHub Actions cron GETs this with
 * the shared secret, then fetches each URL itself (external requests warm the
 * edge cache — the worker can't self-fetch, §warm.ts). Newline-separated so a
 * cron can `xargs curl` it directly. Secret-guarded; never cached.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listWarmUrls } from '@/lib/warm';

export const GET: APIRoute = async ({ request }) => {
  const secret = (env as unknown as Record<string, string>).WARM_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) return new Response('forbidden', { status: 403 });

  const origin = new URL(request.url).origin;
  const hyperdrive = (env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE;
  const urls = await listWarmUrls({ origin, hyperdrive });
  return new Response(urls.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
};
