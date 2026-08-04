/**
 * Reports triage over Postgres (ADMIN.md §7): file → list → resolve/dismiss,
 * escalation flagging, and the open/escalation counts the admin cockpit reads.
 * Skips when DATABASE_URL is unset/unmigrated.
 */
import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';
import { makeReportsApi } from '../src/app/data/db/reports';
import { createDb } from '../src/db/client';
import type { Session } from '../src/app/models/session';

const URL = process.env.DATABASE_URL ?? '';
const probe = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, connect_timeout: 5, prepare: false });
const migrated =
  !!URL &&
  (await probe`select 1 from pg_roles where rolname = 'app_server'`.then(
    (r) => r.length > 0,
    () => false,
  ));
await probe.end();
if (!migrated) console.warn('[db-reports] DATABASE_URL unset/unmigrated — skipped');
const t = test.skipIf(!migrated);

const REPORTER = '00000000-0000-4000-f000-000000000001';
const ADMIN = '00000000-0000-4000-f000-000000000002';

const sql = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, prepare: false });
const db = createDb({ connectionString: URL || 'postgresql://unset@localhost/none' });
const api = makeReportsApi(() => db);
const reporter: Session = { accountId: REPORTER, email: 'reporter@test.local', role: 'client', name: 'Reporter' };

async function cleanup() {
  await sql`delete from reports where reporter_account_id = ${REPORTER}`;
  await sql`delete from accounts where id in (${REPORTER}, ${ADMIN})`;
}
if (migrated) {
  await cleanup();
  await sql`insert into accounts (id, account_type, email, display_name) values
    (${REPORTER}, 'client', ${reporter.email}, 'Reporter'),
    (${ADMIN}, 'admin', 'mod@test.local', 'Mod')`;
}
afterAll(async () => {
  if (migrated) await cleanup();
  await sql.end();
  await db.$client.end();
});

t('file records reporter email (projected) + flags escalation', async () => {
  const normal = await api.file(reporter, { targetKind: 'profile', targetId: 'p1', reason: 'wrong_information' });
  expect(normal.reporterEmail).toBe('reporter@test.local');
  expect(normal.state).toBe('open');
  expect(normal.escalated).toBe(false);

  const escalated = await api.file(reporter, { targetKind: 'profile', targetId: 'p2', reason: 'underage_suspicion' });
  expect(escalated.escalated).toBe(true);
});

t('open + escalation counts reflect the filed reports', async () => {
  expect(await api.openCount()).toBeGreaterThanOrEqual(2);
  expect(await api.escalationCount()).toBeGreaterThanOrEqual(1);
});

t('resolve sets state + projects the handler email', async () => {
  const r = await api.file(reporter, { targetKind: 'profile', targetId: 'p3', reason: 'fake_profile' });
  await api.resolve({ id: r.id, resolution: 'profile_blocked', note: 'confirmed', handledBy: ADMIN });
  const after = await api.byId(r.id);
  expect(after!.state).toBe('resolved');
  expect(after!.resolution).toBe('profile_blocked');
  expect(after!.handledBy).toBe('mod@test.local'); // projected from handled_by uuid
  expect(after!.resolutionNote).toBe('confirmed');
});

t('dismiss closes without a resolution', async () => {
  const r = await api.file(reporter, { targetKind: 'message', targetId: 'm1', reason: 'other', note: 'spam?' });
  await api.dismiss({ id: r.id, note: 'not actionable', handledBy: ADMIN });
  const after = await api.byId(r.id);
  expect(after!.state).toBe('dismissed');
  expect(after!.resolution).toBeUndefined();
});
