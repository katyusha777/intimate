/**
 * Drizzle calls backend (docs/VIDEO-CALLING.md §3/§6). call_sessions has NO
 * browser path (no grants, no policies beyond app_server) — every write comes
 * through here, so this file IS the state machine wall (models/call.ts LEGAL).
 * Ring + state broadcasts are DB triggers (0010/0013); writes just write.
 *
 * Every transition is ONE guarded UPDATE (state + participant checks in the
 * WHERE, outcome from RETURNING) — never a read-then-decide pair: Hyperdrive's
 * read cache can serve a minutes-stale row, and a decision made on a stale
 * state mislabels calls (a 20s call "missed", a decline overwritten by the
 * caller's ring timeout). The DB row is the only referee.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { accounts, callSessions, conversationSettings, profiles, threads } from '@/db/schema';
import { mediaUrl } from '@/app/data/db/profiles';
import {
  CALL_CARD_BODY,
  CallViewSchema,
  RING_TIMEOUT_MS,
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

/** WHERE fragment: the session row belongs to this account (either side). */
const participantSql = (accountId: string) =>
  sql`(${callSessions.clientAccountId} = ${accountId}
    or ${callSessions.profileId} in (select p.id from profiles p where p.account_id = ${accountId}))`;

/**
 * The one terminal writer: guarded UPDATE from the legal source states
 * (models/call.ts LEGAL mirrored in SQL), duration + card computed from the
 * row the UPDATE itself returns. Lost the race (already terminal, not a
 * participant)? Zero rows — no card, null. Without an explicit `to`, reason
 * 'failed' lands in state 'failed' (honest "couldn't connect" card, never a
 * fake "call ended"); otherwise ringing→timeout ("missed"), active→ended.
 */
async function terminate(
  d: Db,
  callId: string,
  reason: string,
  opts: { by?: string; clientOnly?: boolean; froms?: CallState[]; to?: CallState } = {},
): Promise<CallState | null> {
  const froms = opts.froms ?? ['ringing', 'active'];
  const toSql = opts.to
    ? sql`${opts.to}::call_state`
    : sql`(case when ${reason} = 'failed' then 'failed'
                when ${callSessions.state} = 'ringing' then 'timeout'
                else 'ended' end)::call_state`;
  const guards = [
    eq(callSessions.id, callId),
    inArray(callSessions.state, froms),
    ...(opts.by ? [opts.clientOnly ? eq(callSessions.clientAccountId, opts.by) : participantSql(opts.by)] : []),
  ];
  const [row] = await d
    .update(callSessions)
    .set({
      state: toSql as unknown as CallState,
      endedAt: sql`now()`,
      endReason: reason,
      durationS: sql`case when ${callSessions.answeredAt} is null then 0
        else greatest(0, round(extract(epoch from (now() - ${callSessions.answeredAt}))))::int end`,
    })
    .where(and(...guards))
    .returning({ id: callSessions.id, state: callSessions.state, threadId: callSessions.threadId });
  if (!row) return null;
  const body = CALL_CARD_BODY[row.state];
  if (body && row.threadId) {
    await d.insert(messages).values({
      threadId: row.threadId,
      sender: 'system',
      kind: 'call',
      body,
      callId: row.id,
    });
  }
  return row.state;
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
    .select({ id: callSessions.id, state: callSessions.state })
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
    await terminate(d, z.id, 'stale', {
      froms: [z.state],
      to: z.state === 'ringing' ? 'timeout' : 'failed',
    });
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
      // No row = default 'everyone' (2026-08-09, same law as messagingApi
      // .settings): only an explicit stored 'off' blocks calls.
      if (settings?.mode === 'off') return null;

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
      // Latency-critical (tap → media → signaling waits on this): one CAS
      // round-trip, client-party + ringing checks in the WHERE.
      const rows = await db()
        .update(callSessions)
        .set({ state: 'active', answeredAt: sql`now()`, lastBeatAt: sql`now()` })
        .where(
          and(
            eq(callSessions.id, callId),
            eq(callSessions.state, 'ringing'),
            eq(callSessions.clientAccountId, session.accountId),
          ),
        )
        .returning({ id: callSessions.id });
      return rows.length > 0;
    },

    async decline(session, callId) {
      const state = await terminate(db(), callId, 'declined', {
        by: session.accountId,
        clientOnly: true,
        froms: ['ringing'],
        to: 'declined',
      });
      return state === 'declined';
    },

    async end(session, { callId, reason }) {
      // A 'timeout' is a genuinely MISSED call — it may only terminate a still-
      // ringing session. If accept already won the race (state 'active',
      // answeredAt set), a stale caller-side ring timer calling end('timeout')
      // must NOT end it: otherwise it posts a bogus 0s "ended" card for a call
      // that actually connected. Restrict timeout to the ringing source state.
      const froms: CallState[] | undefined = reason === 'timeout' ? ['ringing'] : undefined;
      return (await terminate(db(), callId, reason, { by: session.accountId, froms })) !== null;
    },

    async beat(session, callId) {
      await db()
        .update(callSessions)
        .set({ lastBeatAt: sql`now()` })
        .where(
          and(
            eq(callSessions.id, callId),
            eq(callSessions.state, 'active'),
            participantSql(session.accountId),
          ),
        );
    },
  };
}
