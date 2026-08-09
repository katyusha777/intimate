/**
 * Messaging enforcement (UX-PLAN Phase 4) — the request-sheet deny paths are
 * the whole point, so they're proven against the REAL Postgres backend, not a
 * re-implementation. Same DoD as before the swap: free-compose blocked before
 * an accepted request · request blocked when mode=off or the pair is blocked ·
 * the price snapshot is immutable · decline is silent · participant-only answer.
 *
 * Skips when DATABASE_URL is unset/unmigrated (no local stack in CI).
 */
import { afterAll, beforeEach, expect, test } from 'bun:test';
import postgres from 'postgres';
import { makeMessagingApi } from '../src/app/data/db/messaging';
import { createDb } from '../src/db/client';
import type { Session } from '../src/app/models/session';

const URL = process.env.DATABASE_URL ?? '';
const probe = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, connect_timeout: 5, prepare: false });
const migrated =
  !!URL &&
  (await probe`select 1 from pg_roles where rolname = 'app_server'`.then((r) => r.length > 0, () => false)) &&
  // Latest-migration probe (0014 retention): skip cleanly rather than error on
  // a SELECT of the not-yet-added expires_at column.
  (await probe`select 1 from information_schema.columns where table_name = 'messages' and column_name = 'expires_at'`.then(
    (r) => r.length > 0,
    () => false,
  ));
await probe.end();
if (!migrated) console.warn('[messaging] DATABASE_URL unset/unmigrated — run bun run db:migrate');
const t = test.skipIf(!migrated);

const sql = postgres(URL || 'postgresql://unset@localhost/none', { max: 1, prepare: false });
const db = createDb({ connectionString: URL || 'postgresql://unset@localhost/none' });
const api = makeMessagingApi(() => db);

const PRO_ACCT = '00000000-0000-4000-e000-000000000001';
const CLIENT_ACCT = '00000000-0000-4000-e000-000000000002';
const OTHER_ACCT = '00000000-0000-4000-e000-000000000003';
const PROFILE = '00000000-0000-4000-e000-000000000011';
const SLUG = 'messaging-fixture';

const client: Session = { accountId: CLIENT_ACCT, email: 'msg-client@test.local', role: 'client', name: 'Client' };
const otherClient: Session = { accountId: OTHER_ACCT, email: 'msg-other@test.local', role: 'client', name: 'Other' };
const professional: Session = {
  accountId: PRO_ACCT,
  email: 'msg-pro@test.local',
  role: 'advertiser',
  name: 'Pro',
  profileId: PROFILE,
  profileSlug: SLUG,
};

const REQUEST = {
  service: 'girlfriend_experience' as const,
  duration: 'hour_1' as const,
  priceAtRequest: 150,
  when: 'tonight' as const,
  note: 'first time',
};

async function reset() {
  // Wipe any threads/contacts/settings for the fixture profile + accounts.
  await sql`delete from messages where thread_id in (select id from threads where profile_id = ${PROFILE})`;
  await sql`delete from contacts where profile_id = ${PROFILE}`;
  await sql`delete from threads where profile_id = ${PROFILE}`;
  await sql`delete from conversation_settings where profile_id = ${PROFILE}`;
}

if (migrated) {
  await reset();
  await sql`delete from profiles where id = ${PROFILE}`;
  await sql`delete from accounts where id in (${PRO_ACCT}, ${CLIENT_ACCT}, ${OTHER_ACCT})`;
  await sql`insert into accounts (id, account_type, email, display_name) values
    (${PRO_ACCT}, 'advertiser', ${professional.email}, 'Pro'),
    (${CLIENT_ACCT}, 'client', ${client.email}, 'Client'),
    (${OTHER_ACCT}, 'client', ${otherClient.email}, 'Other')`;
  await sql`insert into profiles (id, account_id, slug, state, name, birth_date, gender, city, rates) values
    (${PROFILE}, ${PRO_ACCT}, ${SLUG}, 'live', 'Pro', '1995-06-15', 'female', 'amsterdam',
     ${JSON.stringify([{ duration: 'hour_1', incall: 150, outcall: 150 }])}::jsonb)`;
}

beforeEach(async () => {
  if (migrated) await reset();
});
afterAll(async () => {
  if (migrated) {
    await reset();
    await sql`delete from profiles where id = ${PROFILE}`;
    await sql`delete from accounts where id in (${PRO_ACCT}, ${CLIENT_ACCT}, ${OTHER_ACCT})`;
  }
  await sql.end();
  await db.$client.end();
});

t('startRequest creates a PENDING thread carrying the request card', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  expect(thread).not.toBeNull();
  expect(thread!.state).toBe('pending');
  expect(thread!.messages.find((m) => m.kind === 'request')?.request?.priceAtRequest).toBe(150);
});

t('DENY: no free-compose on a new thread until an accepted request', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  expect(await api.send(client, { threadId: thread!.id, kind: 'text', body: 'hi there' })).toBeNull();
  expect(await api.send(professional, { threadId: thread!.id, kind: 'text', body: 'hey' })).toBeNull();
  await api.respondRequest(professional, { threadId: thread!.id, accept: true });
  expect(await api.send(client, { threadId: thread!.id, kind: 'text', body: 'thanks!' })).not.toBeNull();
});

t('default (no settings row) ALLOWS a request — reachable unless she opts out', async () => {
  // 2026-08-09: default flipped 'off' → 'everyone'; an un-configured profile
  // must be messageable ("she isn't taking requests" was the whole-app bug).
  expect(await api.startRequest(client, { profileSlug: SLUG, request: REQUEST })).not.toBeNull();
});

t('DENY: request blocked when she explicitly turns messaging off', async () => {
  await api.setMode(professional, 'off');
  expect(await api.startRequest(client, { profileSlug: SLUG, request: REQUEST })).toBeNull();
});

t('verified_only mode blocks an unverified client, allows a phone-verified one', async () => {
  await api.setMode(professional, 'verified_only');
  expect(await api.startThread(client, { profileSlug: SLUG })).toBeNull(); // unverified → closed
  await sql`update accounts set phone_verified_at = now() where id = ${CLIENT_ACCT}`;
  try {
    expect(await api.startThread(client, { profileSlug: SLUG })).not.toBeNull();
  } finally {
    await sql`update accounts set phone_verified_at = null where id = ${CLIENT_ACCT}`;
  }
});

t('DENY: request blocked when the pair is blocked', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  await api.setBlocked(professional, { threadId: thread!.id, blocked: true });
  expect(await api.startRequest(client, { profileSlug: SLUG, request: REQUEST })).toBeNull();
});

t('the price is snapshotted from HER rates, not the client (forged price ignored)', async () => {
  await api.setMode(professional, 'everyone');
  // Client forges a €1 price; the server must overwrite it with her real rate.
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: { ...REQUEST, priceAtRequest: 1 } });
  expect(thread!.messages.find((m) => m.kind === 'request')?.request?.priceAtRequest).toBe(150);
  await api.respondRequest(professional, { threadId: thread!.id, accept: true });
  const after = await api.getThread(client, thread!.id);
  expect(after!.messages.find((m) => m.kind === 'request')?.request?.priceAtRequest).toBe(150);
});

t('DENY: request for a duration she has no rate for is rejected', async () => {
  await api.setMode(professional, 'everyone');
  const noRate = await api.startRequest(client, {
    profileSlug: SLUG,
    request: { ...REQUEST, duration: 'hour_2' as const },
  });
  expect(noRate).toBeNull();
});

t('accept opens the thread, posts a system card, unlocks the private set', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  expect(await api.respondRequest(professional, { threadId: thread!.id, accept: true })).toBe(true);
  const after = await api.getThread(client, thread!.id);
  expect(after!.state).toBe('open');
  expect(after!.privateSetUnlocked).toBe(true);
  expect(after!.messages.some((m) => m.body === 'msg_system_request_accepted')).toBe(true);
});

t('decline is silent — frozen, no accept card, only the quick reply', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  await api.respondRequest(professional, { threadId: thread!.id, accept: false, reply: 'fully booked' });
  const after = await api.getThread(client, thread!.id);
  expect(after!.state).toBe('frozen');
  expect(after!.messages.some((m) => m.body === 'msg_system_request_accepted')).toBe(false);
  expect(after!.messages.some((m) => m.kind === 'text' && m.body === 'fully booked')).toBe(true);
});

t('only the professional can answer a request', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  expect(await api.respondRequest(client, { threadId: thread!.id, accept: true })).toBe(false);
  expect(await api.respondRequest(otherClient, { threadId: thread!.id, accept: true })).toBe(false);
});

t('a stranger cannot read the thread (participant-only)', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  expect(await api.getThread(otherClient, thread!.id)).toBeNull();
  expect(await api.getThread(client, thread!.id)).not.toBeNull();
  expect(await api.getThread(professional, thread!.id)).not.toBeNull();
});

t('client photo is gated on her media grant', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startThread(client, { profileSlug: SLUG });
  const photo = 'data:image/jpeg;base64,AAAA';
  expect(await api.send(client, { threadId: thread!.id, kind: 'photo', photo })).toBeNull();
  await api.setMediaAllowed(professional, { threadId: thread!.id, allowed: true });
  expect(await api.send(client, { threadId: thread!.id, kind: 'photo', photo })).not.toBeNull();
});

t('setScreeningQuestion is professional-only and round-trips', async () => {
  await api.setScreeningQuestion(professional, { question: 'How did you find me?' });
  expect((await api.settings(PROFILE)).screeningQuestion).toBe('How did you find me?');
  await api.setScreeningQuestion(client, { question: 'hacked' });
  expect((await api.settings(PROFILE)).screeningQuestion).toBe('How did you find me?');
});

t('contacts CRM: conversation contact + manual entry, note round-trips', async () => {
  await api.setMode(professional, 'everyone');
  const thread = await api.startThread(client, { profileSlug: SLUG });
  await api.setNote(professional, { threadId: thread!.id, note: 'regular' });
  await api.addContact(professional, { name: 'Walk-in', handle: '+31600000000', note: 'met at bar' });
  const list = await api.listContacts(professional);
  const convo = list.find((c) => c.kind === 'thread');
  const manual = list.find((c) => c.kind === 'manual');
  expect(convo?.note).toBe('regular');
  expect(manual?.name).toBe('Walk-in');
  expect(manual?.handle).toBe('+31600000000');
});

t('unreadCount matches the listThreads sum for both parties, incl. block/hide', async () => {
  await api.setMode(professional, 'everyone');
  // Two threads with traffic in both directions.
  const t1 = await api.startRequest(client, { profileSlug: SLUG, request: REQUEST });
  await api.respondRequest(professional, { threadId: t1!.id, accept: true });
  await api.send(client, { threadId: t1!.id, kind: 'text', body: 'hi' });
  await api.send(professional, { threadId: t1!.id, kind: 'text', body: 'hello' });
  const t2 = await api.startRequest(otherClient, { profileSlug: SLUG, request: REQUEST });

  const sumFor = async (s: Session) =>
    (await api.listThreads(s)).reduce((n, x) => n + x.unread, 0);
  expect(await api.unreadCount(professional)).toBe(await sumFor(professional));
  expect(await api.unreadCount(professional)).toBeGreaterThan(0);
  expect(await api.unreadCount(client)).toBe(await sumFor(client));

  // Reading zeroes it for the reader only.
  await api.markRead(professional, t1!.id);
  expect(await api.unreadCount(professional)).toBe(await sumFor(professional));

  // Block & delete (hiddenBy) drops t2 from her count, like listThreads.
  await api.setBlocked(professional, { threadId: t2!.id, blocked: true, del: true });
  expect(await api.unreadCount(professional)).toBe(await sumFor(professional));
  expect(await api.unreadCount(otherClient)).toBe(await sumFor(otherClient));
});
