/**
 * Seam parity (docs/API.md §2, DATA.md §5): the Drizzle backend must return
 * exactly what the json backend returns for the same params — same rows, same
 * order, same totals, same projected shapes. Both share applyProfileListParams,
 * so this is really testing the row→Profile projection (media join, enum
 * arrays, jsonb round-trips, timestamp formats, derived online/priceFrom).
 *
 * Ignored per item: `id` (json 'p01' vs db uuid) and `lastActiveAt` (mock
 * online flag becomes a fresh heartbeat at seed time) — everything else is
 * deep-equal. Skips when DATABASE_URL is unset or unmigrated. NOTE: reseeds
 * the mock catalog into the database it points at.
 */
import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';
import { profilesApi as jsonApi } from '../src/app/data/json/profiles';
import { makeProfilesApi } from '../src/app/data/db/profiles';
import { createDb } from '../src/db/client';
import { seed } from '../scripts/seed-dev';
import type { Profile, ProfileListParams } from '../src/app/models/profile';

const URL = process.env.DATABASE_URL ?? '';

const probe = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, connect_timeout: 5, prepare: false });
const migrated =
  !!URL &&
  (await probe`select 1 from pg_roles where rolname = 'app_server'`.then(
    (r) => r.length > 0,
    () => false,
  ));
await probe.end();
if (!migrated) console.warn('[db-parity] DATABASE_URL unset/unmigrated — parity skipped');

const t = test.skipIf(!migrated);

if (migrated) await seed(URL);
const db = createDb({ connectionString: URL || 'postgresql://unset@localhost/none' });
const dbApi = makeProfilesApi(db);
afterAll(async () => {
  await db.$client.end();
});

/** Comparable shape: parity holds on everything except id + heartbeat value. */
const comparable = ({ id: _id, lastActiveAt: _la, ...rest }: Profile) => rest;

const PARAM_SETS: Array<[name: string, params: ProfileListParams]> = [
  ['default listing', {}],
  ['city path', { city: 'amsterdam' }],
  ['city union', { city: 'amsterdam', cities: ['rotterdam', 'utrecht'] }],
  ['gender filter', { genders: ['female'] }],
  ['service any-match', { services: ['girlfriend_experience', 'erotic_massage'] }],
  ['service category', { serviceCategory: 'massage' }],
  ['meeting type', { meetingType: 'incall' }],
  ['price band + sort', { priceMin: 50, priceMax: 150, sort: 'price_low_high' }],
  ['price desc', { sort: 'price_high_low' }],
  ['newest', { sort: 'newest' }],
  ['online only', { onlineOnly: true }],
  ['available now', { availableNow: true }],
  ['verified only', { verifiedOnly: true }],
  ['featured only', { featuredOnly: true }],
  ['text search', { q: 'massage' }],
  ['paging', { limit: 5, offset: 5 }],
  ['count query', { limit: 0 }],
];

for (const [name, params] of PARAM_SETS) {
  t(`list parity: ${name}`, async () => {
    const [a, b] = await Promise.all([jsonApi.list(params), dbApi.list(params)]);
    expect(b.total).toBe(a.total);
    expect(b.items.map((p) => p.slug)).toEqual(a.items.map((p) => p.slug));
    expect(b.items.map(comparable)).toEqual(a.items.map(comparable));
  });
}

t('bySlug parity (incl. projection deep-equality)', async () => {
  const { items } = await jsonApi.list({ limit: 3 });
  for (const p of items) {
    const fromDb = await dbApi.bySlug(p.slug);
    expect(fromDb).not.toBeNull();
    expect(comparable(fromDb!)).toEqual(comparable(p));
  }
});

t('bySlug: unknown and non-live stay hidden', async () => {
  expect(await dbApi.bySlug('does-not-exist')).toBeNull();
});
