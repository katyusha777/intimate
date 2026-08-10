/**
 * RLS deny tests (SECURITY.md §3: every policy ships with its deny test).
 * Exercises drizzle/0001_security.sql against the project database
 * (DATABASE_URL in .env) by impersonating PostgREST roles: `set local role
 * anon|authenticated` plus a `request.jwt.claims` sub — exactly what the API
 * does, minus HTTP. Fixtures are fixed-UUID rows, cleaned up after.
 *
 * Skips (with a warning) when DATABASE_URL is unset or unreachable.
 */
import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

const URL = process.env.DATABASE_URL;
const sql = postgres(URL ?? 'postgresql://unset@localhost/none', { max: 1, connect_timeout: 5, prepare: false });

const up =
  !!URL &&
  (await sql`select 1`.then(
    () => true,
    () => false,
  ));
if (!up) console.warn('[rls.test] DATABASE_URL unset/unreachable — deny tests skipped');

// Applied-migration probe: tests are meaningless against a bare schema. Also
// checks the latest migration's column (0014 retention) so the suite skips
// cleanly rather than erroring on a SELECT of a not-yet-added column.
const migrated =
  up &&
  (await sql`select 1 from pg_roles where rolname = 'app_server'`.then((r) => r.length > 0, () => false)) &&
  (await sql`select 1 from information_schema.columns where table_name = 'messages' and column_name = 'expires_at'`.then(
    (r) => r.length > 0,
    () => false,
  ));
if (up && !migrated) console.warn('[rls.test] schema behind — run bun run db:migrate');

const t = test.skipIf(!migrated);

// ── fixtures (fixed UUIDs → idempotent re-runs) ─────────────────────────────
const PRO = '00000000-0000-4000-8000-000000000001'; // professional account
const CLI = '00000000-0000-4000-8000-000000000002'; // client in the thread
const STR = '00000000-0000-4000-8000-000000000003'; // stranger client
const P_LIVE = '00000000-0000-4000-8000-000000000011';
const P_DRAFT = '00000000-0000-4000-8000-000000000012';
const M_PUB = '00000000-0000-4000-8000-000000000021'; // approved public media
const M_PEND = '00000000-0000-4000-8000-000000000022'; // pending media
const M_PRIV = '00000000-0000-4000-8000-000000000023'; // approved private media
const M_DRAFT = '00000000-0000-4000-8000-000000000024'; // approved media, draft profile
const TH = '00000000-0000-4000-8000-000000000031'; // thread PRO×CLI
const CS = '00000000-0000-4000-8000-000000000041'; // call session in TH

async function seed() {
  await cleanup();
  await sql`insert into accounts (id, account_type, email, display_name) values
    (${PRO}, 'advertiser', 'pro@test.local', 'Pro'),
    (${CLI}, 'client', 'cli@test.local', 'Cli'),
    (${STR}, 'client', 'str@test.local', 'Str')`;
  await sql`insert into profiles (id, account_id, slug, state, name, birth_date, gender, city) values
    (${P_LIVE}, ${PRO}, 'rls-live', 'live', 'Live', '1995-06-15', 'female', 'amsterdam'),
    (${P_DRAFT}, ${PRO}, 'rls-draft', 'draft', 'Draft', '1995-06-15', 'female', 'utrecht')`;
  await sql`insert into media (id, profile_id, state, image_key, is_private) values
    (${M_PUB}, ${P_LIVE}, 'approved', 'k-pub', false),
    (${M_PEND}, ${P_LIVE}, 'pending_review', 'k-pend', false),
    (${M_PRIV}, ${P_LIVE}, 'approved', 'k-priv', true),
    (${M_DRAFT}, ${P_DRAFT}, 'approved', 'k-draft', false)`;
  await sql`insert into threads (id, profile_id, client_account_id) values (${TH}, ${P_LIVE}, ${CLI})`;
  await sql`insert into messages (thread_id, sender, kind, body) values (${TH}, 'client', 'text', 'hi')`;
  await sql`insert into call_sessions (id, profile_id, client_account_id, thread_id, mode) values (${CS}, ${P_LIVE}, ${CLI}, ${TH}, 'voice')`;
}

async function cleanup() {
  // FK order. audit_log is append-only — never seeded outside rolled-back txns.
  await sql`delete from call_sessions where id = ${CS}`;
  await sql`delete from messages where thread_id = ${TH}`;
  await sql`delete from favorites where profile_id in (${P_LIVE}, ${P_DRAFT})`;
  await sql`delete from threads where id = ${TH}`;
  await sql`delete from media where profile_id in (${P_LIVE}, ${P_DRAFT})`;
  await sql`delete from profiles where id in (${P_LIVE}, ${P_DRAFT})`;
  await sql`delete from accounts where id in (${PRO}, ${CLI}, ${STR})`;
}

if (migrated) await seed();
afterAll(async () => {
  if (migrated) await cleanup();
  await sql.end();
});

/** Run `fn` as a PostgREST role inside a rolled-back transaction. */
async function as<T>(
  role: 'anon' | 'authenticated' | 'app_server' | 'postgres',
  uid: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await sql`begin`;
  try {
    const claims = uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role });
    await sql`select set_config('request.jwt.claims', ${claims}, true)`;
    await sql.unsafe(`set local role ${role}`);
    return await fn();
  } finally {
    await sql`rollback`;
  }
}

const denied = (p: Promise<unknown>) =>
  expect(p).rejects.toThrow(/permission denied|row-level security/);

// ── profiles ────────────────────────────────────────────────────────────────

t('anon sees live profiles only', async () => {
  const rows = await as('anon', null, () => sql`select slug from profiles where id in (${P_LIVE}, ${P_DRAFT})`);
  expect(rows.map((r) => r.slug)).toEqual(['rls-live']);
});

t('owner sees her own draft; a stranger does not', async () => {
  const own = await as('authenticated', PRO, () => sql`select slug from profiles where id = ${P_DRAFT}`);
  expect(own.length).toBe(1);
  const other = await as('authenticated', STR, () => sql`select slug from profiles where id = ${P_DRAFT}`);
  expect(other.length).toBe(0);
});

t('anon cannot write profiles at all', async () => {
  await denied(as('anon', null, () => sql`update profiles set last_active_at = now() where id = ${P_LIVE}`));
});

t('heartbeat: owner updates own last_active_at; stranger hits 0 rows', async () => {
  const mine = await as('authenticated', PRO, () =>
    sql`update profiles set last_active_at = now() where id = ${P_LIVE} returning id`);
  expect(mine.length).toBe(1);
  const theirs = await as('authenticated', STR, () =>
    sql`update profiles set last_active_at = now() where id = ${P_LIVE} returning id`);
  expect(theirs.length).toBe(0);
});

t('heartbeat grant is column-scoped: owner cannot update name', async () => {
  await denied(as('authenticated', PRO, () => sql`update profiles set name = 'X' where id = ${P_LIVE}`));
});

t('DB floor: under-21 profile insert violates CHECK', async () => {
  await expect(
    as('postgres', null, () => sql`insert into profiles (account_id, slug, state, name, birth_date, gender, city)
      values (${PRO}, 'rls-young', 'draft', 'Young', ${new Date(Date.now() - 20 * 365.25 * 86400_000).toISOString().slice(0, 10)}, 'female', 'amsterdam')`),
  ).rejects.toThrow(/profiles_min_age/);
});

t('state change stamps state_changed_at (trigger)', async () => {
  const [before] = await sql`select state_changed_at from profiles where id = ${P_LIVE}`;
  await sql`update profiles set state = 'paused' where id = ${P_LIVE}`;
  const [after] = await sql`select state, state_changed_at from profiles where id = ${P_LIVE}`;
  expect(after!.state).toBe('paused');
  expect(after!.state_changed_at > before!.state_changed_at).toBe(true);
  await sql`update profiles set state = 'live' where id = ${P_LIVE}`;
});

// ── media ───────────────────────────────────────────────────────────────────

// Scoped to the fixture profiles — the dev-seed catalog may coexist in the DB.
t('public media = approved + non-private + live profile only', async () => {
  const rows = await as('anon', null, () =>
    sql`select image_key from media where profile_id in (${P_LIVE}, ${P_DRAFT}) order by image_key`);
  expect(rows.map((r) => r.image_key)).toEqual(['k-pub']);
});

t('owner sees all her media incl. pending/private', async () => {
  const rows = await as('authenticated', PRO, () =>
    sql`select count(*)::int as n from media where profile_id in (${P_LIVE}, ${P_DRAFT})`);
  expect(rows[0]!.n).toBe(4);
});

// ── accounts ────────────────────────────────────────────────────────────────

t('account row is own-row only; anon has no grant', async () => {
  const own = await as('authenticated', CLI, () => sql`select email from accounts`);
  expect(own.map((r) => r.email)).toEqual(['cli@test.local']);
  await denied(as('anon', null, () => sql`select * from accounts`));
});

// ── threads & messages ──────────────────────────────────────────────────────

t('threads visible to both participants, invisible to strangers', async () => {
  for (const [uid, n] of [
    [CLI, 1],
    [PRO, 1],
    [STR, 0],
  ] as const) {
    const rows = await as('authenticated', uid, () => sql`select id from threads where id = ${TH}`);
    expect(rows.length).toBe(n);
  }
});

t('messages readable by participants only', async () => {
  const cli = await as('authenticated', CLI, () => sql`select body from messages where thread_id = ${TH}`);
  expect(cli.length).toBe(1);
  const str = await as('authenticated', STR, () => sql`select body from messages where thread_id = ${TH}`);
  expect(str.length).toBe(0);
});

t('browser cannot insert messages (server action path only)', async () => {
  await denied(as('authenticated', CLI, () => sql`insert into messages (thread_id, sender, kind, body) values (${TH}, 'client', 'text', 'x')`));
});

t('one thread per (profile, client) pair', async () => {
  await expect(
    as('postgres', null, () => sql`insert into threads (profile_id, client_account_id) values (${P_LIVE}, ${CLI})`),
  ).rejects.toThrow(/threads_pair_idx|duplicate key/);
});

// ── favorites ───────────────────────────────────────────────────────────────

t('favorites: own-row insert/select/delete; forging another client denied', async () => {
  await as('authenticated', CLI, async () => {
    await sql`insert into favorites (client_account_id, profile_id) values (${CLI}, ${P_LIVE})`;
    const mine = await sql`select profile_id from favorites`;
    expect(mine.length).toBe(1);
    await sql`delete from favorites where profile_id = ${P_LIVE}`;
  });
  await denied(as('authenticated', CLI, () => sql`insert into favorites (client_account_id, profile_id) values (${STR}, ${P_LIVE})`));
});

// ── no-grant tables: PostgREST roles can't touch them at all ────────────────

for (const table of ['orgs', 'conversation_settings', 'contacts', 'reports', 'audit_log', 'verification_docs', 'import_jobs']) {
  t(`${table}: zero browser access`, async () => {
    await denied(as('anon', null, () => sql.unsafe(`select * from public.${table} limit 1`)));
    await denied(as('authenticated', CLI, () => sql.unsafe(`select * from public.${table} limit 1`)));
  });
}

// ── audit_log append-only (binds even postgres) ─────────────────────────────

t('audit_log rows can never be rewritten', async () => {
  // .then() materializes the lazy PendingQuery into a real Promise — bun's
  // expect().rejects never executes a raw postgres-js query and hangs.
  await as('postgres', null, async () => {
    await sql`insert into audit_log (admin_account_id, admin_email, admin_role, action, entity_type, entity_id)
      values (${PRO}, 'admin@test.local', 'super', 'add_note', 'profile', 'x')`;
    await expect(sql`update audit_log set reason = 'rewrite' where entity_id = 'x'`.then()).rejects.toThrow(/append-only/);
  });
  await as('postgres', null, async () => {
    await sql`insert into audit_log (admin_account_id, admin_email, admin_role, action, entity_type, entity_id)
      values (${PRO}, 'admin@test.local', 'super', 'add_note', 'profile', 'y')`;
    await expect(sql`delete from audit_log where entity_id = 'y'`.then()).rejects.toThrow(/append-only/);
  });
});

// ── app_server: the RLS-exempt server path ──────────────────────────────────

t('app_server reads drafts and no-grant tables (full access)', async () => {
  const rows = await as('app_server', null, () => sql`select slug from profiles where id = ${P_DRAFT}`);
  expect(rows.length).toBe(1);
  const audit = await as('app_server', null, () => sql`select count(*) from audit_log`);
  expect(audit.length).toBe(1);
});

// ── private helper hygiene ──────────────────────────────────────────────────

t('anon cannot execute private.is_thread_participant', async () => {
  await denied(as('anon', null, () => sql`select private.is_thread_participant(${TH}::uuid)`));
});

// ── realtime wiring ─────────────────────────────────────────────────────────

t('realtime.messages carries our policies', async () => {
  const rows = await sql`select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages'`;
  const names = rows.map((r) => r.policyname);
  for (const p of [
    'thread participants listen',
    'thread participants send',
    'presence listen',
    'presence track',
    'call participants listen',
    'call participants send',
  ]) {
    expect(names).toContain(p);
  }
});

// The trystero rtc channel (`call:{id}:rtc`, src/app/callroom.ts) rides the
// 0010 call policies: `topic LIKE 'call:%'` + is_call_participant on
// split_part position 2. Prove BOTH assumptions — suffix-tolerant parsing and
// the participant gate per role — exactly as the policy evaluates them.
t("rtc signaling topic 'call:{id}:rtc' authorizes participants only", async () => {
  const topic = `call:${CS}:rtc`;
  const check = (uid: string) =>
    as('authenticated', uid, () =>
      sql`select private.is_call_participant(split_part(${topic}, ':', 2)::uuid) as ok`,
    );
  expect((await check(CLI))[0]!.ok).toBe(true); // the client in the thread
  expect((await check(PRO))[0]!.ok).toBe(true); // the professional
  expect((await check(STR))[0]!.ok).toBe(false); // a stranger — no signaling path
});

t('message insert broadcasts to the private thread topic + touches the thread', async () => {
  await as('postgres', null, async () => {
    // realtime.messages is day-partitioned BY THE REALTIME SERVICE; on a
    // project where Realtime has never run, today's partition may not exist
    // and realtime.send degrades to a WARNING (writes never break — by
    // design). Probe first; only assert delivery when the store is live.
    await sql`select realtime.send('{}'::jsonb, 'probe', ${'probe:' + TH}, true)`;
    const probed = await sql`select 1 from realtime.messages where topic = ${'probe:' + TH}`;

    const [t0] = await sql`select last_message_at from threads where id = ${TH}`;
    await Bun.sleep(5);
    await sql`insert into messages (thread_id, sender, kind, body) values (${TH}, 'professional', 'text', 'yo')`;
    const [t1] = await sql`select last_message_at from threads where id = ${TH}`;
    expect(t1!.last_message_at >= t0!.last_message_at).toBe(true);

    if (probed.length === 0) {
      console.warn('[rls.test] realtime partitions not provisioned — broadcast delivery unasserted (trigger wiring still exercised)');
      return;
    }
    const bc = await sql`select topic, private from realtime.messages where topic = ${'thread:' + TH} order by inserted_at desc limit 1`;
    expect(bc.length).toBe(1);
    expect(bc[0]!.private).toBe(true);
  });
});

t('every public table has RLS enabled', async () => {
  const rows = await sql`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
  expect(rows.map((r) => r.relname)).toEqual([]);
});
