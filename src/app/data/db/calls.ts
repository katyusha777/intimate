/**
 * Drizzle calls backend (docs/VIDEO-CALLING.md §3/§6). call_sessions has NO
 * browser path (no grants, no policies beyond app_server) — every write comes
 * through here, so this file IS the state machine wall (models/call.ts LEGAL).
 * Ring + state broadcasts are DB triggers (0010); inserts/updates just write.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { accounts, callSessions, conversationSettings, profiles, threads } from '@/db/schema';
import { mediaUrl } from '@/app/data/db/profiles';
import {
  CALL_CARD_BODY,
  CallViewSchema,
  RING_TIMEOUT_MS,
  canTransition,
  type CallView,
  type CallsApi,
} from '@/app/models/call';
import { messages } from '@/db/schema';
import type { CallState } from '@/lib/taxonomy';
import type { Session } from '@/app/models/session';

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

interface SessionRow {
  id: string;
  threadId: string | null;
  mode: 'voice' | 'video';
  state: CallState;
  profileId: string;
  clientAccountId: string | null;
  profileAccountId: string;
  profileName: string;
  clientName: string | null;
  clientEmail: string | null;
  avatarKey: string | null;
  startedAt: Date;
  answeredAt: Date | null;
}

async function loadCall(d: Db, callId: string): Promise<SessionRow | null> {
  const [row] = await d
    .select({
      id: callSessions.id,
      threadId: callSessions.threadId,
      mode: callSessions.mode,
      state: callSessions.state,
      profileId: callSessions.profileId,
      clientAccountId: callSessions.clientAccountId,
      profileAccountId: profiles.accountId,
      profileName: profiles.name,
      clientName: accounts.displayName,
      clientEmail: accounts.email,
      // Her ring-overlay face: first approved public photo, if any.
      avatarKey: sql<string | null>`(
        select m.image_key from media m
        where m.profile_id = ${callSessions.profileId}
          and m.state = 'approved' and not m.is_private
        order by m.position limit 1)`,
      startedAt: callSessions.startedAt,
      answeredAt: callSessions.answeredAt,
    })
    .from(callSessions)
    .innerJoin(profiles, eq(profiles.id, callSessions.profileId))
    .leftJoin(accounts, eq(accounts.id, callSessions.clientAccountId))
    .where(eq(callSessions.id, callId))
    .limit(1);
  return row ?? null;
}

function partyOf(session: Session, c: SessionRow): 'professional' | 'client' | null {
  if (session.accountId === c.profileAccountId) return 'professional';
  if (c.clientAccountId && session.accountId === c.clientAccountId) return 'client';
  return null;
}

function toView(c: SessionRow, party: 'professional' | 'client'): CallView {
  const clientName = c.clientName ?? (c.clientEmail ?? '').split('@')[0] ?? 'Client';
  return CallViewSchema.parse({
    id: c.id,
    threadId: c.threadId ?? '',
    mode: c.mode,
    state: c.state,
    party,
    peerName: party === 'professional' ? clientName : c.profileName,
    profileId: c.profileId,
    avatarUrl: c.avatarKey ? mediaUrl(c.avatarKey) : undefined,
    startedAt: iso(c.startedAt),
    answeredAt: c.answeredAt ? iso(c.answeredAt) : undefined,
  });
}

/** Terminal transition + its thread card, in one place. */
async function finish(d: Db, c: SessionRow, to: CallState, reason: string): Promise<void> {
  const now = new Date();
  const seconds = c.answeredAt
    ? Math.max(0, Math.round((now.getTime() - new Date(c.answeredAt).getTime()) / 1000))
    : 0;
  await d
    .update(callSessions)
    .set({ state: to, endedAt: now, endReason: reason, durationS: seconds })
    .where(eq(callSessions.id, c.id));
  const body = CALL_CARD_BODY[to];
  if (body && c.threadId) {
    await d.insert(messages).values({
      threadId: c.threadId,
      sender: 'system',
      kind: 'call',
      body,
      callId: c.id,
    });
  }
}

/**
 * Lazily sweep this profile's zombie sessions (caller tab died mid-ring, beat
 * stopped mid-call) so the busy check stays honest. ponytail: swept on her
 * next start() — a cron would also catch abandoned CLIENT-side zombies, add
 * one if support tickets say so.
 */
async function sweepStale(d: Db, profileId: string): Promise<void> {
  // ISO strings, not Date objects: postgres-js can't infer a raw-SQL param's
  // type under prepare:false and throws trying to bind a bare Date (the
  // call.start 500). The ::timestamptz cast keeps the comparison correct.
  const staleRing = new Date(Date.now() - RING_TIMEOUT_MS * 2).toISOString();
  const staleBeat = new Date(Date.now() - 2 * 60_000).toISOString();
  const zombies = await d
    .select({ id: callSessions.id })
    .from(callSessions)
    .where(
      and(
        eq(callSessions.profileId, profileId),
        inArray(callSessions.state, ['ringing', 'active']),
        sql`(${callSessions.state} = 'ringing' and ${callSessions.startedAt} < ${staleRing}::timestamptz)
         or (${callSessions.state} = 'active'
             and coalesce(${callSessions.lastBeatAt}, ${callSessions.startedAt}) < ${staleBeat}::timestamptz)`,
      ),
    );
  for (const z of zombies) {
    const c = await loadCall(d, z.id);
    if (c) await finish(d, c, c.state === 'ringing' ? 'timeout' : 'failed', 'stale');
  }
}

export function makeCallsApi(db: () => Db): CallsApi {
  return {
    async start(session, { threadId, mode }) {
      if (!session.profileId) return null; // professionals only (law 0.2)
      const d = db();
      const [t] = await d
        .select({
          id: threads.id,
          profileId: threads.profileId,
          clientAccountId: threads.clientAccountId,
          state: threads.state,
          clientName: accounts.displayName,
          clientEmail: accounts.email,
        })
        .from(threads)
        .innerJoin(accounts, eq(accounts.id, threads.clientAccountId))
        .where(and(eq(threads.id, threadId), eq(threads.profileId, session.profileId)))
        .limit(1);
      if (!t || t.state !== 'open') return null;
      const [settings] = await d
        .select({ mode: conversationSettings.mode })
        .from(conversationSettings)
        .where(eq(conversationSettings.profileId, t.profileId))
        .limit(1);
      if (!settings || settings.mode === 'off') return null;

      await sweepStale(d, t.profileId);
      const live = await d
        .select({ id: callSessions.id })
        .from(callSessions)
        .where(
          and(
            eq(callSessions.profileId, t.profileId),
            inArray(callSessions.state, ['ringing', 'active']),
          ),
        )
        .limit(1);
      if (live.length) return 'busy';

      const [row] = await d
        .insert(callSessions)
        .values({
          profileId: t.profileId,
          clientAccountId: t.clientAccountId,
          clientName: t.clientName ?? (t.clientEmail ?? '').split('@')[0] ?? 'Client',
          threadId: t.id,
          mode,
          state: 'ringing',
        })
        .returning({ id: callSessions.id });
      const c = await loadCall(d, row!.id);
      return c ? toView(c, 'professional') : null;
    },

    async get(session, callId) {
      const c = await loadCall(db(), callId);
      if (!c) return null;
      const party = partyOf(session, c);
      return party ? toView(c, party) : null;
    },

    async accept(session, callId) {
      const d = db();
      const c = await loadCall(d, callId);
      if (!c || partyOf(session, c) !== 'client') return false;
      if (!canTransition(c.state, 'active')) return false;
      await d
        .update(callSessions)
        .set({ state: 'active', answeredAt: new Date(), lastBeatAt: new Date() })
        .where(and(eq(callSessions.id, callId), eq(callSessions.state, 'ringing')));
      return true;
    },

    async decline(session, callId) {
      const d = db();
      const c = await loadCall(d, callId);
      if (!c || partyOf(session, c) !== 'client') return false;
      if (!canTransition(c.state, 'declined')) return false;
      await finish(d, c, 'declined', 'declined');
      return true;
    },

    async end(session, { callId, reason }) {
      const d = db();
      const c = await loadCall(d, callId);
      if (!c || !partyOf(session, c)) return false;
      const to: CallState = c.state === 'ringing' ? (reason === 'failed' ? 'failed' : 'timeout') : 'ended';
      // A hangup DURING ring by the caller counts as her giving up → timeout
      // ("missed" card) — the client shouldn't see "declined" he never sent.
      if (!canTransition(c.state, to)) return false;
      await finish(d, c, to, reason);
      return true;
    },

    async beat(session, callId) {
      const d = db();
      const c = await loadCall(d, callId);
      if (!c || !partyOf(session, c) || c.state !== 'active') return;
      await d.update(callSessions).set({ lastBeatAt: new Date() }).where(eq(callSessions.id, callId));
    },
  };
}
