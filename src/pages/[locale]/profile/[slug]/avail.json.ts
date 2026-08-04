/**
 * Fresh availability for one profile — the live bit the 24h-cached profile page
 * (page-cache.ts) deliberately leaves out. Layout's post-paint refresh fetches
 * this and patches the [data-avail-*] hooks so a cached shell is never stale.
 * Never cached (no-store); runs under paraglide so labels match the URL locale.
 */
import type { APIRoute } from 'astro';
import { profilesApi } from '@/app/api/profiles';
import { availabilityState } from '@/app/models/profile';
import { availabilityView } from '@/lib/labels';

export const GET: APIRoute = async ({ params }) => {
  const p = params.slug ? await profilesApi.bySlug(params.slug) : null;
  if (!p) return new Response('null', { status: 404, headers: { 'cache-control': 'no-store' } });
  // ponytail: reuses bySlug (full row) for one field pair — add a slim
  // last_active_at/opening_hours query if this shows up in profiling.
  return Response.json(availabilityView(availabilityState(p)), {
    headers: { 'cache-control': 'no-store' },
  });
};
