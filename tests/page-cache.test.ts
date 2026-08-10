/**
 * The edge cache must fire on exactly the canonical public profile page — never
 * on /avail.json (the live badge feed), filter/query variants, or other routes.
 * A wrong match here silently serves stale or uncacheable content.
 */
import { expect, test } from 'bun:test';
import { bustProfiles, isAnonymousRequest, isCacheableProfile, servedFromCache, storeInCache, type CacheKv } from '@/lib/page-cache';

/** Minimal in-memory KV for the store/serve round-trip. */
const fakeKv = (): CacheKv & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, async get(k) { return map.get(k) ?? null; }, async put(k, v) { map.set(k, v); } };
};
const htmlRes = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const cacheable = (path: string, search = '') =>
  isCacheableProfile(new URL(`https://x${path}${search}`));

test('caches canonical profile pages in every locale', () => {
  expect(cacheable('/nl/profile/elif/')).toBe(true);
  expect(cacheable('/en/profile/elif/')).toBe(true);
  expect(cacheable('/de/profile/elif')).toBe(true); // trailing slash optional
});

test('never caches the live availability feed or query variants', () => {
  expect(cacheable('/en/profile/elif/avail.json')).toBe(false);
  expect(cacheable('/en/profile/elif/', '?utm=x')).toBe(false);
});

test('only anonymous requests may be cached (no leaking a logged-in header)', () => {
  expect(isAnonymousRequest(null)).toBe(true);
  expect(isAnonymousRequest('city=amsterdam; theme=dark')).toBe(true);
  // Supabase session cookie present → NOT anonymous → must skip the cache.
  expect(isAnonymousRequest('sb-jqrfzqbuvekhcptqcpda-auth-token=abc')).toBe(false);
  expect(isAnonymousRequest('city=x; sb-jqrfzqbuvekhcptqcpda-auth-token.0=abc')).toBe(false);
});

test('leaves non-profile routes alone', () => {
  expect(cacheable('/en/')).toBe(false);
  expect(cacheable('/en/amsterdam/')).toBe(false);
  expect(cacheable('/en/account/profile')).toBe(false);
  expect(cacheable('/admin/profiles')).toBe(false);
});

test('a new deploy id invalidates cached HTML (no stale-after-redeploy)', async () => {
  const kv = fakeKv();
  const url = new URL('https://x/en/profile/elif/');
  await storeInCache(kv, 'deploy-v1', url, htmlRes('<p>v1</p>'));

  // Same deploy → HIT.
  const hit = await servedFromCache(kv, 'deploy-v1', url);
  expect(hit).not.toBeNull();
  expect(await hit!.text()).toBe('<p>v1</p>');
  expect(hit!.headers.get('cache-control')).toBe('no-cache'); // browsers revalidate

  // New deploy id → MISS (old entry unreachable), so the fresh render is served.
  expect(await servedFromCache(kv, 'deploy-v2', url)).toBeNull();
});

test('a bust invalidates AND blocks re-caching during the stale-read window', async () => {
  const kv = fakeKv();
  const url = new URL('https://x/en/profile/elif/');
  await storeInCache(kv, 'd1', url, htmlRes('<p>live</p>'));
  expect(await servedFromCache(kv, 'd1', url)).not.toBeNull();

  await bustProfiles(kv); // e.g. deletion approved
  expect(await servedFromCache(kv, 'd1', url)).toBeNull(); // old gen unreachable

  // A render right after the bust may carry Hyperdrive-stale data — it must
  // NOT be stored under the new generation (it would live until the TTL).
  const res = await storeInCache(kv, 'd1', url, htmlRes('<p>stale</p>'));
  expect(await res.text()).toBe('<p>stale</p>'); // response passes through untouched
  expect(await servedFromCache(kv, 'd1', url)).toBeNull(); // …but was not cached
});
