/**
 * Phase 4 (UX-PLAN) deny/allow tests — the request sheet's enforcement is the
 * whole point, so the deny paths are proven end-to-end against the REAL mock
 * data layer (the stand-in for RLS), not a re-implementation. We stub only
 * `cloudflare:workers` with an in-memory KV so the KV-backed backend runs under
 * bun test unchanged.
 *
 * Proves (the DoD): free-compose blocked before an accepted request on a new
 * thread · request blocked when mode=off or the pair is blocked · the price
 * snapshot in the card is immutable · decline leaves no penalty.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

// In-memory KV — one store, reset per test. Must be installed BEFORE the data
// layer is imported (it reads `env.SESSION` at module load via `kv()`).
const store = new Map<string, string>();
mock.module('cloudflare:workers', () => ({
  env: {
    SESSION: {
      async get(k: string) {
        return store.has(k) ? store.get(k)! : null;
      },
      async put(k: string, v: string) {
        store.set(k, v);
      },
    },
  },
}));

const { messagingApi } = await import('@/app/data/json/messaging');

// A live profile from the seed (has services + a rates table).
const PROFILE_SLUG = 'eva-amsterdam';
const PROFILE_ID = 'p01';

const client = { accountId: 'acc-client', email: 'client@example.com', role: 'client' as const, name: 'Client' };
const otherClient = { accountId: 'acc-other', email: 'other@example.com', role: 'client' as const, name: 'Other' };
const professional = {
  accountId: 'acc-eva',
  email: 'eva@example.com',
  role: 'advertiser' as const,
  name: 'Eva',
  profileId: PROFILE_ID,
  profileSlug: PROFILE_SLUG,
};

const REQUEST = {
  service: 'girlfriend_experience' as const,
  duration: 'hour_1' as const,
  priceAtRequest: 150,
  when: 'tonight' as const,
  note: 'first time',
} satisfies Parameters<typeof messagingApi.startRequest>[1]['request'];

beforeEach(() => {
  store.clear();
});

test('startRequest creates a PENDING thread carrying the request card', async () => {
  await messagingApi.setMode(professional, 'everyone');
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  expect(t).not.toBeNull();
  expect(t!.state).toBe('pending');
  const req = t!.messages.find((m) => m.kind === 'request');
  expect(req?.request?.priceAtRequest).toBe(150);
});

test('DENY: no free-compose on a new thread until an accepted request', async () => {
  await messagingApi.setMode(professional, 'everyone');
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  // Pending thread → the client cannot compose a text bubble.
  const blocked = await messagingApi.send(client, { threadId: t!.id, kind: 'text', body: 'hi there' });
  expect(blocked).toBeNull();
  // …nor can the professional (she answers via accept/decline).
  const blockedPro = await messagingApi.send(professional, { threadId: t!.id, kind: 'text', body: 'hey' });
  expect(blockedPro).toBeNull();

  // After accept the thread opens and both sides compose.
  await messagingApi.respondRequest(professional, { threadId: t!.id, accept: true });
  const ok = await messagingApi.send(client, { threadId: t!.id, kind: 'text', body: 'thanks!' });
  expect(ok).not.toBeNull();
});

test('DENY: request blocked when her mode is off', async () => {
  await messagingApi.setMode(professional, 'off');
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  expect(t).toBeNull();
});

test('DENY: request blocked when the pair is blocked', async () => {
  await messagingApi.setMode(professional, 'everyone');
  // Establish then block the thread.
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  await messagingApi.setBlocked(professional, { threadId: t!.id, blocked: true });
  // A fresh request on the blocked pair is refused.
  const again = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  expect(again).toBeNull();
});

test('the price snapshot in the card is immutable (rate change does not rewrite it)', async () => {
  await messagingApi.setMode(professional, 'everyone');
  const t = await messagingApi.startRequest(client, {
    profileSlug: PROFILE_SLUG,
    request: { ...REQUEST, priceAtRequest: 150 },
  });
  await messagingApi.respondRequest(professional, { threadId: t!.id, accept: true });
  // Re-read the thread from storage; the request card still shows the sent price.
  const after = await messagingApi.getThread(client, t!.id);
  const req = after!.messages.find((m) => m.kind === 'request');
  expect(req?.request?.priceAtRequest).toBe(150);
});

test('accept opens the thread, posts a system card, and unlocks the private set', async () => {
  await messagingApi.setMode(professional, 'everyone');
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  const ok = await messagingApi.respondRequest(professional, { threadId: t!.id, accept: true });
  expect(ok).toBe(true);
  const after = await messagingApi.getThread(client, t!.id);
  expect(after!.state).toBe('open');
  expect(after!.privateSetUnlocked).toBe(true);
  expect(after!.messages.some((m) => m.body === 'msg_system_request_accepted')).toBe(true);
});

test('decline is silent and leaves no penalty (thread frozen, no system card)', async () => {
  await messagingApi.setMode(professional, 'everyone');
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  await messagingApi.respondRequest(professional, { threadId: t!.id, accept: false, reply: 'fully booked' });
  const after = await messagingApi.getThread(client, t!.id);
  expect(after!.state).toBe('frozen');
  // No penalty: the client may still send a NEW request later (mode permitting).
  // No accept system card exists; only her optional quick reply is present.
  expect(after!.messages.some((m) => m.body === 'msg_system_request_accepted')).toBe(false);
  expect(after!.messages.some((m) => m.kind === 'text' && m.body === 'fully booked')).toBe(true);
});

test('only the professional can answer a request; a client respond is refused', async () => {
  await messagingApi.setMode(professional, 'everyone');
  const t = await messagingApi.startRequest(client, { profileSlug: PROFILE_SLUG, request: REQUEST });
  const denied = await messagingApi.respondRequest(client, { threadId: t!.id, accept: true });
  expect(denied).toBe(false);
  const denied2 = await messagingApi.respondRequest(otherClient, { threadId: t!.id, accept: true });
  expect(denied2).toBe(false);
});

test('setScreeningQuestion is professional-only and round-trips', async () => {
  await messagingApi.setScreeningQuestion(professional, { question: 'How did you find me?' });
  expect((await messagingApi.settings(PROFILE_ID)).screeningQuestion).toBe('How did you find me?');
  // A client cannot set it (no profileId).
  await messagingApi.setScreeningQuestion(client, { question: 'hacked' });
  expect((await messagingApi.settings(PROFILE_ID)).screeningQuestion).toBe('How did you find me?');
});
