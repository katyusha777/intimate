/**
 * The moderation + ownership loop over the real schema (DATA.md): the admin
 * surface sees every state, `setState` is a real UPDATE that the PUBLIC list
 * respects, and favorites round-trip through their table.
 *
 * These are the guarantees the admin queues and the account dashboard depend
 * on — the mock enforced them in KV, Postgres enforces them now. Skips when
 * DATABASE_URL is unset/unmigrated.
 */
import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';
import { makeProfilesApi, mediaUrl } from '../src/app/data/db/profiles';
import { createDb } from '../src/db/client';

// Pure (no DB) — the media-URL branch: R2 keys route through /media, seed and
// static/remote keys pass through untouched.
test('mediaUrl routes R2 keys and passes through static/remote', () => {
  expect(mediaUrl('pub/abc/def')).toBe('/media/pub/abc/def');
  expect(mediaUrl('priv/abc/def')).toBe('/media/priv/abc/def');
  expect(mediaUrl('/nsfwimg/seed.jpg')).toBe('/nsfwimg/seed.jpg');
  expect(mediaUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
});

const URL = process.env.DATABASE_URL ?? '';
const probe = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, connect_timeout: 5, prepare: false });
const migrated =
  !!URL &&
  (await probe`select 1 from pg_roles where rolname = 'app_server'`.then(
    (r) => r.length > 0,
    () => false,
  ));
await probe.end();
if (!migrated) console.warn('[db-account] DATABASE_URL unset/unmigrated — skipped');
const t = test.skipIf(!migrated);

const ACCOUNT = '00000000-0000-4000-c000-000000000001';
const PROFILE = '00000000-0000-4000-c000-000000000002';
const SLUG = 'moderation-loop-fixture';

const sql = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, prepare: false });
const db = createDb({ connectionString: URL || 'postgresql://unset@localhost/none' });
const api = makeProfilesApi(db);

async function cleanup() {
  await sql`delete from favorites where profile_id = ${PROFILE}`;
  await sql`delete from media where profile_id = ${PROFILE}`;
  await sql`delete from profiles where id = ${PROFILE}`;
  await sql`delete from accounts where id = ${ACCOUNT}`;
}

if (migrated) {
  await cleanup();
  await sql`insert into accounts (id, account_type, email, display_name) values
    (${ACCOUNT}, 'advertiser', 'moderation-fixture@test.local', 'Fixture')`;
  // Starts as a draft — exactly what a fresh advertiser's first save produces.
  await sql`insert into profiles (id, account_id, slug, state, name, birth_date, gender, city) values
    (${PROFILE}, ${ACCOUNT}, ${SLUG}, 'draft', 'Fixture', '1995-06-15', 'female', 'amsterdam')`;
}

afterAll(async () => {
  if (migrated) await cleanup();
  await sql.end();
  await db.$client.end();
});

t('a draft is invisible to the public but visible to admin', async () => {
  expect(await api.bySlug(SLUG)).toBeNull();
  const { items } = await api.list({ limit: 60 });
  expect(items.some((p) => p.slug === SLUG)).toBe(false);

  const all = await api.listAll();
  expect(all.some((p) => p.slug === SLUG)).toBe(true);
  expect((await api.byId(PROFILE))?.state).toBe('draft');
});

t('approve → live publishes it to the public shelf', async () => {
  await api.setState(PROFILE, 'live');
  expect((await api.bySlug(SLUG))?.state).toBe('live');
  const { items } = await api.list({ limit: 60, city: 'amsterdam' });
  expect(items.some((p) => p.slug === SLUG)).toBe(true);
});

t('block → the public page dies, admin keeps it', async () => {
  await api.setState(PROFILE, 'blocked');
  expect(await api.bySlug(SLUG)).toBeNull();
  expect((await api.byId(PROFILE))?.state).toBe('blocked');
});

t('lifecycle transitions stamp state_changed_at (DB trigger)', async () => {
  const [before] = await sql`select state_changed_at from profiles where id = ${PROFILE}`;
  await Bun.sleep(5);
  await api.setState(PROFILE, 'paused');
  const [after] = await sql`select state_changed_at from profiles where id = ${PROFILE}`;
  expect(after!.state_changed_at > before!.state_changed_at).toBe(true);
});

t('media states gate the public gallery, owner sees everything', async () => {
  await api.setState(PROFILE, 'live');
  const ok = `pub/${PROFILE}/ok`, pending = `pub/${PROFILE}/pending`, priv = `priv/${PROFILE}/p`;
  await sql`insert into media (profile_id, state, image_key, is_private, position) values
    (${PROFILE}, 'approved', ${ok}, false, 0),
    (${PROFILE}, 'pending_review', ${pending}, false, 1),
    (${PROFILE}, 'approved', ${priv}, true, 2)`;

  // Projection routes R2 keys through /media.
  const publicView = await api.bySlug(SLUG);
  expect(publicView?.photos).toEqual([`/media/${ok}`]);
  expect(publicView?.privatePhotos).toEqual([`/media/${priv}`]);

  // The owner/admin projection includes photos still in review.
  const ownerView = await api.byId(PROFILE);
  expect(ownerView?.photos).toEqual([`/media/${ok}`, `/media/${pending}`]);
});
