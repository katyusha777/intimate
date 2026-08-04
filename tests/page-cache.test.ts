/**
 * The edge cache must fire on exactly the canonical public profile page — never
 * on /avail.json (the live badge feed), filter/query variants, or other routes.
 * A wrong match here silently serves stale or uncacheable content.
 */
import { expect, test } from 'bun:test';
import { isCacheableProfile } from '@/lib/page-cache';

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

test('leaves non-profile routes alone', () => {
  expect(cacheable('/en/')).toBe(false);
  expect(cacheable('/en/amsterdam/')).toBe(false);
  expect(cacheable('/en/account/profile')).toBe(false);
  expect(cacheable('/admin/profiles')).toBe(false);
});
