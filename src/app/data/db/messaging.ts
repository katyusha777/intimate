/**
 * Drizzle messaging backend (docs/MESSAGING.md, DATA.md): threads · messages ·
 * contacts (the professional's CRM: note/pin/media-grant/private-unlock, one
 * row per thread) · conversation_settings. Replaces the KV mock; the seam
 * (api/messaging.ts) is the switch.
 *
 * Participation is decided from the session, never trusted from input — same
 * `partyOf` law as the mock (professional = owns the profile; client = the
 * thread's account by email). last_message_at + realtime broadcast are handled
 * by the message-insert triggers (drizzle/0001), so inserts don't touch them.
 *
 * Fresh Db per call (workerd forbids cross-request I/O reuse).
 */
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  accounts,
  callSessions,
  contactInvites,
  contacts,
  conversationSettings,
  messages,
  profiles,
  threads,
} from '@/db/schema';
import { sendPush } from '@/lib/push';
import { emailNewMessage } from '@/lib/email';
import { pushoverAdmins } from '@/lib/pushover';
import {
  ConversationSettingsSchema,
  RequestPayloadSchema,
  ThreadSchema,
  replySpeed,
  type ContactInvite,
  type ContactItem,
  type ConversationSettings,
  type Message,
  type MessagingApi,
  type Party,
  type ReplySpeed,
  type Thread,
  type ThreadMeta,
  type ThreadSummary,
} from '@/app/models/messaging';
import type { Session } from '@/app/models/session';
import { mediaUrl } from '@/app/data/db/profiles';
import { ratesMinPrice, type RateRow } from '@/app/models/profile';
import { TEAM_INTIMATE_ACCOUNT_ID, TEAM_INTIMATE_NAME, welcomeBody } from '@/lib/welcome';

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

// ── projection ──────────────────────────────────────────────────────────────

type MsgRow = typeof messages.$inferSelect;
type CallInfo = NonNullable<Message['call']>;
function toMessage(m: MsgRow, calls?: Map<string, CallInfo>): Message {
  return {
    id: m.id,
    sender: m.sender,
    kind: m.kind,
    body: m.body,
    photo: m.imageKey ?? undefined, // chat photo (data-URL inline for now)
    request: m.request ?? undefined,
    call: m.callId ? calls?.get(m.callId) : undefined, // call card ← its session
    createdAt: iso(m.createdAt),
    readAt: m.readAt ? iso(m.readAt) : undefined,
  };
}

/** call_id → {mode,state,seconds} for the call cards in a message batch. */
async function callInfoFor(d: Db, msgs: MsgRow[]): Promise<Map<string, CallInfo>> {
  const ids = [...new Set(msgs.flatMap((m) => (m.callId ? [m.callId] : [])))];
  if (!ids.length) return new Map();
  const rows = await d
    .select({ id: callSessions.id, mode: callSessions.mode, state: callSessions.state, seconds: callSessions.durationS })
    .from(callSessions)
    .where(inArray(callSessions.id, ids));
  return new Map(rows.map((r) => [r.id, { mode: r.mode, state: r.state, seconds: r.seconds }]));
}

interface ThreadJoin {
  id: string;
  profileId: string;
  clientAccountId: string;
  profileSlug: string;
  profileName: string;
  avatarKey: string | null;
  clientEmail: string | null;
  clientName: string | null;
  state: Thread['state'];
  blockedBy: Party | null;
  hiddenBy: Party | null;
  createdAt: Date;
  lastMessageAt: Date;
  pinned: boolean | null;
  note: string | null;
  clientMediaAllowed: boolean | null;
  privateSetUnlocked: boolean | null;
}

function toThread(r: ThreadJoin, msgs: MsgRow[], calls?: Map<string, CallInfo>): Thread {
  const email = r.clientEmail ?? '';
  return ThreadSchema.parse({
    id: r.id,
    profileId: r.profileId,
    profileSlug: r.profileSlug,
    profileName: r.profileName,
    profileAvatarUrl: r.avatarKey ? mediaUrl(r.avatarKey) : undefined,
    clientEmail: email,
    clientName: r.clientName ?? email.split('@')[0] ?? 'Client',
    isTeam: r.clientAccountId === TEAM_INTIMATE_ACCOUNT_ID,
    state: r.state,
    blockedBy: r.blockedBy ?? undefined,
    hiddenBy: r.hiddenBy ?? undefined,
    createdAt: iso(r.createdAt),
    lastMessageAt: iso(r.lastMessageAt),
    pinned: r.pinned ?? false,
    note: r.note ?? '',
    clientMediaAllowed: r.clientMediaAllowed ?? false,
    privateSetUnlocked: r.privateSetUnlocked ?? false,
    messages: msgs.map((m) => toMessage(m, calls)),
  });
}

/** threads ⟕ profiles ⟕ accounts ⟕ contacts + messages → projected Thread[]. */
async function loadThreads(d: Db, where: SQL): Promise<Thread[]> {
  const rows: ThreadJoin[] = await d
    .select({
      id: threads.id,
      profileId: threads.profileId,
      clientAccountId: threads.clientAccountId,
      profileSlug: profiles.slug,
      profileName: profiles.name,
      // Client-side chat avatar: her first approved public photo (same
      // subquery as the call ring overlay in calls.ts).
      avatarKey: sql<string | null>`(
        select m.image_key from media m
        where m.profile_id = ${threads.profileId}
          and m.state = 'approved' and not m.is_private
        order by m.position limit 1)`,
      clientEmail: accounts.email,
      clientName: accounts.displayName,
      state: threads.state,
      blockedBy: threads.blockedBy,
      hiddenBy: threads.hiddenBy,
      createdAt: threads.createdAt,
      lastMessageAt: threads.lastMessageAt,
      pinned: contacts.pinned,
      note: contacts.note,
      clientMediaAllowed: contacts.clientMediaAllowed,
      privateSetUnlocked: contacts.privateSetUnlocked,
    })
    .from(threads)
    .innerJoin(profiles, eq(profiles.id, threads.profileId))
    .innerJoin(accounts, eq(accounts.id, threads.clientAccountId))
    .leftJoin(contacts, eq(contacts.threadId, threads.id))
    .where(where);
  if (!rows.length) return [];
  // ponytail: loads every message of every matched thread to build summaries;
  // push snippet+unread into SQL when a pro's inbox gets large.
  const ids = rows.map((r) => r.id);
  const msgs = await d.select().from(messages).where(inArray(messages.threadId, ids)).orderBy(messages.createdAt);
  const calls = await callInfoFor(d, msgs);
  const byThread = new Map<string, MsgRow[]>();
  for (const m of msgs) (byThread.get(m.threadId) ?? byThread.set(m.threadId, []).get(m.threadId)!).push(m);
  return rows.map((r) => toThread(r, byThread.get(r.id) ?? [], calls));
}

/** Which side is the session on? Same law as the mock (client keyed by email). */
function partyOf(session: Session, t: Thread): Party | null {
  if (session.profileId && session.profileId === t.profileId) return 'professional';
  if (session.email.toLowerCase() === t.clientEmail.toLowerCase()) return 'client';
  return null;
}

// System cards aren't unread messages (don't badge her for a card she triggered).
function unreadFor(t: Thread, party: Party): number {
  return t.messages.filter((m) => m.sender !== party && m.sender !== 'system' && !m.readAt).length;
}
function snippetFor(t: Thread): string {
  const last = [...t.messages].reverse().find((m) => m.kind !== 'system');
  if (!last) return '';
  if (last.kind === 'photo') return '📷';
  if (last.kind === 'call') return '📞';
  if (last.kind === 'request') return 'msg_snippet_request';
  return last.body;
}
function toSummary(t: Thread, party: Party): ThreadSummary {
  return {
    id: t.id,
    profileId: t.profileId,
    profileSlug: t.profileSlug,
    profileName: t.profileName,
    profileAvatarUrl: t.profileAvatarUrl,
    clientEmail: t.clientEmail,
    clientName: t.clientName,
    isTeam: t.isTeam,
    state: t.state,
    pinned: t.pinned,
    note: t.note,
    clientMediaAllowed: t.clientMediaAllowed,
    lastMessageAt: t.lastMessageAt,
    snippet: snippetFor(t),
    unread: unreadFor(t, party),
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** A live profile's id from a slug — you message from a live page. */
async function liveProfileId(
  d: Db,
  slug: string,
): Promise<{ id: string; accountId: string; rates: RateRow[] } | undefined> {
  return (
    await d
      .select({ id: profiles.id, accountId: profiles.accountId, rates: profiles.rates })
      .from(profiles)
      .where(and(eq(profiles.slug, slug), eq(profiles.state, 'live')))
      .limit(1)
  )[0];
}

/** Push recipients (the Thread model carries emails, not account ids). */
async function profileOwnerAccount(d: Db, profileId: string): Promise<string | undefined> {
  const [p] = await d.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.id, profileId)).limit(1);
  return p?.accountId;
}
async function threadClientAccount(d: Db, threadId: string): Promise<string | undefined> {
  const [t] = await d.select({ clientAccountId: threads.clientAccountId }).from(threads).where(eq(threads.id, threadId)).limit(1);
  return t?.clientAccountId;
}

/** Is this client account phone-verified? (gates 'verified_only' inbox mode.) */
async function clientPhoneVerified(d: Db, accountId: string): Promise<boolean> {
  const [a] = await d
    .select({ v: accounts.phoneVerifiedAt })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return !!a?.v;
}

/** Her inbox mode gate for a CLIENT reaching her: 'off' closed; 'verified_only'
 *  needs a phone-verified client; 'everyone' open. Only queries verification
 *  when the mode actually requires it. */
async function clientPassesMode(
  d: Db,
  accountId: string,
  mode: ConversationSettings['mode'],
): Promise<boolean> {
  if (mode === 'off') return false;
  if (mode === 'verified_only') return clientPhoneVerified(d, accountId);
  return true;
}

type InviteRow = typeof contactInvites.$inferSelect;
function toInvite(r: InviteRow): ContactInvite {
  return {
    id: r.id,
    token: r.token,
    name: r.name,
    createdAt: iso(r.createdAt),
    expiresAt: iso(r.expiresAt),
    claimed: !!r.claimedBy,
  };
}

async function findThread(d: Db, profileId: string, clientAccountId: string): Promise<Thread | null> {
  const rows = await loadThreads(d, and(eq(threads.profileId, profileId), eq(threads.clientAccountId, clientAccountId))!);
  return rows[0] ?? null;
}

/** Create the thread + its CRM contact row (1:1). Returns the loaded Thread. */
async function createThread(
  d: Db,
  profileId: string,
  clientAccountId: string,
  state: Thread['state'],
): Promise<Thread> {
  const [row] = await d
    .insert(threads)
    .values({ profileId, clientAccountId, state })
    .onConflictDoNothing()
    .returning({ id: threads.id });
  const id =
    row?.id ??
    (await d
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.profileId, profileId), eq(threads.clientAccountId, clientAccountId)))
      .limit(1))[0]!.id;
  if (row) {
    await d
      .insert(contacts)
      .values({ profileId, kind: 'thread', threadId: id, clientAccountId })
      .onConflictDoNothing();
  }
  return (await loadThreads(d, eq(threads.id, id)))[0]!;
}

/**
 * One-time welcome DM from Team Intimate to a brand-new professional (feedback
 * v7 #7). Team Intimate is a fixed system account on the CLIENT side, so it
 * lands in her inbox and she can reply. Self-bootstraps the account row (one
 * system record isn't worth a migration). Called once, on first profile save.
 */
export async function createWelcomeThread(d: Db, profileId: string): Promise<void> {
  await d
    .insert(accounts)
    .values({ id: TEAM_INTIMATE_ACCOUNT_ID, accountType: 'client', displayName: TEAM_INTIMATE_NAME })
    .onConflictDoNothing();
  const thread = await createThread(d, profileId, TEAM_INTIMATE_ACCOUNT_ID, 'open');
  await d.insert(messages).values({
    threadId: thread.id,
    sender: 'client',
    kind: 'text',
    body: welcomeBody(),
  });
}

/**
 * Backend over a per-call Db factory (workerd forbids sharing a client across
 * requests → `db()` returns a fresh one). The seam (api/messaging.ts) injects
 * the Hyperdrive binding; tests inject a local-Postgres factory.
 */
export function makeMessagingApi(db: () => Db): MessagingApi {
  return {
  async settings(profileId) {
    const [row] = await db()
      .select()
      .from(conversationSettings)
      .where(eq(conversationSettings.profileId, profileId))
      .limit(1);
    // No row → default 'everyone' (2026-08-09): un-configured profiles are
    // reachable, so a client can always send. Opt-out (off / verified_only) is
    // an explicit stored row.
    if (!row) return ConversationSettingsSchema.parse({});
    return ConversationSettingsSchema.parse({
      mode: row.mode,
      allowCallRequests: row.allowCallRequests,
      screeningQuestion: row.screeningQuestion,
    });
  },

  async setMode(session, mode) {
    if (!session.profileId) return;
    await db()
      .insert(conversationSettings)
      .values({ profileId: session.profileId, mode })
      .onConflictDoUpdate({ target: conversationSettings.profileId, set: { mode } });
  },

  async setScreeningQuestion(session, { question }) {
    if (!session.profileId) return;
    const screeningQuestion = question.slice(0, 140);
    await db()
      .insert(conversationSettings)
      .values({ profileId: session.profileId, screeningQuestion })
      .onConflictDoUpdate({ target: conversationSettings.profileId, set: { screeningQuestion } });
  },

  async listThreads(session) {
    const d = db();
    const where = session.profileId
      ? eq(threads.profileId, session.profileId)
      : eq(threads.clientAccountId, session.accountId);
    const party: Party = session.profileId ? 'professional' : 'client';
    return (await loadThreads(d, where))
      // Blocked threads stay listed for the BLOCKER (badge in the UI) unless
      // they chose block-&-delete (hiddenBy). The blocked side never sees it.
      .filter((t) => (t.state !== 'blocked' || t.blockedBy === party) && t.hiddenBy !== party)
      .map((t) => toSummary(t, party))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.localeCompare(a.lastMessageAt));
  },

  async unreadCount(session) {
    // Mirrors listThreads exactly: messages from the OTHER party (never
    // 'system'), unread, in my threads, minus blocked-against-me and hidden.
    const party: Party = session.profileId ? 'professional' : 'client';
    const other: Party = party === 'professional' ? 'client' : 'professional';
    const [row] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          session.profileId
            ? eq(threads.profileId, session.profileId)
            : eq(threads.clientAccountId, session.accountId),
          eq(messages.sender, other),
          isNull(messages.readAt),
          or(ne(threads.state, 'blocked'), eq(threads.blockedBy, party)),
          or(isNull(threads.hiddenBy), ne(threads.hiddenBy, party)),
        ),
      );
    return row?.n ?? 0;
  },

  async getThread(session, threadId) {
    const [t] = await loadThreads(db(), eq(threads.id, threadId));
    if (!t || !partyOf(session, t)) return null; // participant-only
    return t;
  },

  async poll(session, threadId, after) {
    const [t] = await loadThreads(db(), eq(threads.id, threadId));
    if (!t) return null;
    const party = partyOf(session, t);
    if (!party) return null;
    const list = after ? t.messages.filter((m) => m.createdAt > after) : t.messages;
    const mine = t.messages.filter((m) => m.sender === party && m.readAt);
    const readUpTo = mine.length ? mine[mine.length - 1]!.createdAt : null;
    return {
      messages: list,
      readUpTo,
      clientMediaAllowed: t.clientMediaAllowed,
      privateSetUnlocked: t.privateSetUnlocked,
      state: t.state,
    };
  },

  async startThread(session, { profileSlug }) {
    if (session.profileId) return null; // clients only initiate
    const d = db();
    const profile = await liveProfileId(d, profileSlug);
    if (!profile) return null;
    // Her inbox, her rules: 'off' closed, 'verified_only' needs a verified client.
    if (!(await clientPassesMode(d, session.accountId, (await this.settings(profile.id)).mode))) return null;
    const existing = await findThread(d, profile.id, session.accountId);
    if (existing) return existing;
    return createThread(d, profile.id, session.accountId, 'open');
  },

  async startRequest(session, { profileSlug, request }) {
    if (session.profileId) return null;
    const d = db();
    const profile = await liveProfileId(d, profileSlug);
    if (!profile) return null;
    if (!(await clientPassesMode(d, session.accountId, (await this.settings(profile.id)).mode))) return null;
    // UGC is data — re-validate at the wall even though the action parsed it.
    const parsed = RequestPayloadSchema.safeParse(request);
    if (!parsed.success) return null;

    // Price is authoritative from HER rates for the chosen duration — never the
    // client-supplied number (a client could otherwise claim €0). Unknown
    // duration (no matching rate row) → reject the request entirely. No
    // duration at all (profile has no preset rates — the sheet skipped the
    // step) → no price on the card.
    const requestData = { ...parsed.data };
    delete requestData.priceAtRequest;
    if (parsed.data.duration !== undefined) {
      const rateRow = profile.rates.find((r) => r.duration === parsed.data.duration);
      const price = rateRow ? ratesMinPrice([rateRow]) : undefined;
      if (price === undefined) return null;
      requestData.priceAtRequest = price;
    }

    let thread = await findThread(d, profile.id, session.accountId);
    if (thread?.state === 'blocked') return null; // blocked pair → no request path
    if (!thread) thread = await createThread(d, profile.id, session.accountId, 'pending');
    else await d.update(threads).set({ state: 'pending' }).where(eq(threads.id, thread.id));

    await d.insert(messages).values({
      threadId: thread.id,
      sender: 'client',
      kind: 'request',
      request: requestData,
    });
    // His note rides on the card, but also lands as a real chat message so the
    // thread reads like a conversation, not just a form (feedback v7).
    if (requestData.note) {
      await d.insert(messages).values({
        threadId: thread.id,
        sender: 'client',
        kind: 'text',
        body: requestData.note,
      });
    }
    sendPush({ accountId: profile.accountId, category: 'requests', path: `/messages/${thread.id}/` });
    // A new request is the money moment — always email her (push is best-effort).
    {
      const [acc] = await d.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, profile.accountId));
      if (acc?.email) emailNewMessage(acc.email, thread.id);
    }
    // IDs only to the US processor (SECURITY.md) — no client email; the slug is public.
    pushoverAdmins('client_message', 'New request', `client ${session.accountId} → ${profileSlug}`);
    return (await loadThreads(d, eq(threads.id, thread.id)))[0]!;
  },

  async respondRequest(session, { threadId, accept, reply }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t || partyOf(session, t) !== 'professional') return false;
    if (t.state !== 'pending') return false;

    if (accept) {
      await d.update(threads).set({ state: 'open' }).where(eq(threads.id, threadId));
      // Accept unlocks her private set for THIS client (UX-PLAN 4.4) + system card.
      await d.update(contacts).set({ privateSetUnlocked: true }).where(eq(contacts.threadId, threadId));
      await d.insert(messages).values({ threadId, sender: 'system', kind: 'system', body: 'msg_system_request_accepted' });
      const clientAccount = await threadClientAccount(d, threadId);
      if (clientAccount) sendPush({ accountId: clientAccount, category: 'messages', path: `/messages/${threadId}/`, collapseId: threadId });
    } else {
      // Decline closes SILENTLY (frozen, invisible in listThreads); the optional
      // quick reply is the ONLY thing the client sees.
      const clean = (reply ?? '').trim().slice(0, 4000);
      if (clean) await d.insert(messages).values({ threadId, sender: 'professional', kind: 'text', body: clean });
      await d.update(threads).set({ state: 'frozen' }).where(eq(threads.id, threadId));
    }
    return true;
  },

  async send(session, { threadId, kind, body = '', photo }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t) return null;
    const party = partyOf(session, t);
    if (!party) return null;
    // Free-compose only on an OPEN thread — a pending request blocks both sides
    // (the UX-PLAN 4.1 throttle) and blocked kills it.
    if (t.state !== 'open') return null;
    // Team Intimate welcome thread is READ-ONLY: nobody staffs that inbox, so
    // a reply would silently vanish — the UI points at WhatsApp/Telegram.
    if (t.isTeam) return null;

    if (party === 'client') {
      if (!(await clientPassesMode(d, session.accountId, (await this.settings(t.profileId)).mode))) return null;
      if (kind === 'photo' && !t.clientMediaAllowed) return null; // her grant gates his media
    }
    const clean = body.trim().slice(0, 4000);
    if (kind === 'text' && !clean) return null;
    if (kind === 'photo' && !photo) return null;

    // Email throttle: she gets a mail only when this message STARTS an unread
    // burst (no unread client messages before it) — not one mail per message.
    const firstUnread =
      party === 'client' &&
      (
        await d
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(eq(messages.threadId, threadId), eq(messages.sender, 'client'), isNull(messages.readAt)))
      )[0]!.n === 0;

    const [row] = await d
      .insert(messages)
      .values({
        threadId,
        sender: party,
        kind,
        body: kind === 'text' ? clean : '',
        imageKey: kind === 'photo' ? photo : null,
      })
      .returning();
    // Notify the OTHER side; collapse per thread so a burst is one banner.
    const to = party === 'client' ? await profileOwnerAccount(d, t.profileId) : await threadClientAccount(d, threadId);
    if (row && to) {
      sendPush({ accountId: to, category: 'messages', path: `/messages/${threadId}/`, collapseId: threadId });
      // Push is best-effort (few subscribe) — a new unread burst also emails
      // her. ponytail: also fires when push DID land; gate on OneSignal
      // subscription state if double-notifying ever annoys.
      if (firstUnread) {
        const [acc] = await d.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, to));
        if (acc?.email) emailNewMessage(acc.email, threadId);
        // The event is "client messages a professional" — her replies must not
        // ping the admin team.
        if (party === 'client')
          pushoverAdmins('client_message', 'New message', `new message in thread ${threadId}`);
      }
    }
    return row ? toMessage(row) : null;
  },

  async markRead(session, threadId) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t) return;
    const party = partyOf(session, t);
    if (!party) return;
    // Mark the OTHER side's unread messages read.
    await d
      .update(messages)
      .set({ readAt: sql`now()` })
      .where(and(eq(messages.threadId, threadId), ne(messages.sender, party), isNull(messages.readAt)));
  },

  async setNote(session, { threadId, note }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t || partyOf(session, t) !== 'professional') return;
    await d.update(contacts).set({ note: note.slice(0, 500) }).where(eq(contacts.threadId, threadId));
  },

  async setPinned(session, { threadId, pinned }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t || partyOf(session, t) !== 'professional') return;
    const updated = await d
      .update(contacts)
      .set({ pinned })
      .where(eq(contacts.threadId, threadId))
      .returning({ id: contacts.id });
    if (updated.length || !pinned) return;
    // Starring a thread that never became a contact makes it one — her
    // address book IS the favorites surface (conversation-derived row).
    const [row] = await d
      .select({ clientAccountId: threads.clientAccountId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    await d.insert(contacts).values({
      profileId: t.profileId,
      kind: 'thread',
      threadId,
      clientAccountId: row?.clientAccountId ?? null,
      name: t.clientName || t.clientEmail.split('@')[0] || 'Client',
      pinned: true,
    });
  },

  async setMediaAllowed(session, { threadId, allowed }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t || partyOf(session, t) !== 'professional') return;
    if (t.clientMediaAllowed === allowed) return;
    await d.update(contacts).set({ clientMediaAllowed: allowed }).where(eq(contacts.threadId, threadId));
    // Granting is explained with a system card; revoking is silent.
    if (allowed) await d.insert(messages).values({ threadId, sender: 'system', kind: 'system', body: 'msg_system_media_on' });
  },

  async setBlocked(session, { threadId, blocked, del }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t) return;
    const party = partyOf(session, t);
    if (!party) return;
    // The blocked party must not be able to overwrite the block: if the thread
    // is already blocked by the OTHER side, refuse to re-block (which would flip
    // blockedBy and let them then unblock and resume). Only the blocker owns it.
    if (t.state === 'blocked' && t.blockedBy && t.blockedBy !== party) return;
    if (blocked) {
      // Plain block keeps the thread listed with a badge; "block & delete"
      // also hides it from the blocker's lists (items.md #1).
      await d
        .update(threads)
        .set({ state: 'blocked', blockedBy: party, hiddenBy: del ? party : t.hiddenBy ?? null })
        .where(eq(threads.id, threadId));
    } else if (t.blockedBy === party) {
      // Unblock restores fully — the hidden flag clears so the chat reappears.
      await d.update(threads).set({ state: 'open', blockedBy: null, hiddenBy: null }).where(eq(threads.id, threadId));
    }
  },

  async hideThread(session, { threadId }) {
    const d = db();
    const [t] = await loadThreads(d, eq(threads.id, threadId));
    if (!t) return;
    const party = partyOf(session, t);
    // Delete-later exists only for a thread YOU blocked (an open chat can't be
    // deleted — the 1-thread-per-pair row is the anti-spam bedrock).
    if (!party || t.state !== 'blocked' || t.blockedBy !== party) return;
    await d.update(threads).set({ hiddenBy: party }).where(eq(threads.id, threadId));
  },

  async listBlocked(session) {
    const d = db();
    const where = session.profileId
      ? eq(threads.profileId, session.profileId)
      : eq(threads.clientAccountId, session.accountId);
    const party: Party = session.profileId ? 'professional' : 'client';
    return (await loadThreads(d, where))
      .filter((t) => t.state === 'blocked' && t.blockedBy === party)
      .map((t) => toSummary(t, party));
  },

  async listContacts(session) {
    if (!session.profileId) return [];
    const d = db();
    // Conversation contacts (auto): her threads — blocked ones stay with a
    // badge unless she chose block-&-delete (items.md #1).
    const fromThreads: ContactItem[] = (await loadThreads(d, eq(threads.profileId, session.profileId)))
      .filter((t) => (t.state !== 'blocked' || t.blockedBy === 'professional') && t.hiddenBy !== 'professional')
      .map((t) => ({
        id: t.id,
        name: t.clientName,
        note: t.note,
        handle: '',
        pinned: t.pinned,
        kind: 'thread' as const,
        threadId: t.id,
        mediaAllowed: t.clientMediaAllowed,
        blocked: t.state === 'blocked',
      }));
    // Manual address-book entries (contacts rows with no thread).
    const manual = await d
      .select()
      .from(contacts)
      .where(and(eq(contacts.profileId, session.profileId), eq(contacts.kind, 'manual')));
    const fromManual: ContactItem[] = manual.map((c) => ({
      id: c.id,
      name: c.name,
      note: c.note,
      handle: c.handle,
      pinned: false,
      kind: 'manual' as const,
    }));
    return [...fromThreads, ...fromManual].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name),
    );
  },

  async addContact(session, { name, handle = '', note = '' }) {
    if (!session.profileId) return;
    // Adding a KNOWN email connects to that client's account (speed-dial,
    // VIDEO-CALLING.md §0): open a thread so she can message/call — not an inert
    // card. No match → a plain address-book entry, as before.
    const email = handle.trim().toLowerCase();
    if (email.includes('@')) {
      const d = db();
      const [acct] = await d
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(sql`lower(${accounts.email}) = ${email}`, eq(accounts.accountType, 'client')))
        .limit(1);
      if (acct && acct.id !== session.accountId) {
        let thread = await findThread(d, session.profileId, acct.id);
        if (thread?.state === 'blocked') return; // never silently reconnect a block
        if (!thread) thread = await createThread(d, session.profileId, acct.id, 'open');
        else if (thread.state !== 'open')
          await d.update(threads).set({ state: 'open' }).where(eq(threads.id, thread.id));
        // Her private label lands on the thread contact's note (never shown to him).
        const label = note.trim() || name.trim();
        if (label)
          await d
            .update(contacts)
            .set({ note: label })
            .where(and(eq(contacts.threadId, thread.id), eq(contacts.kind, 'thread')));
        return;
      }
    }
    await db().insert(contacts).values({ profileId: session.profileId, kind: 'manual', name, handle, note });
  },

  async updateContact(session, { id, name, handle = '', note = '' }) {
    if (!session.profileId) return;
    // Scoped to HER manual contacts — a foreign id updates nothing.
    await db()
      .update(contacts)
      .set({ name, handle, note })
      .where(and(eq(contacts.id, id), eq(contacts.profileId, session.profileId), eq(contacts.kind, 'manual')));
  },

  async removeContact(session, { id }) {
    if (!session.profileId) return;
    await db()
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.profileId, session.profileId), eq(contacts.kind, 'manual')));
  },

  // ── invite links (VIDEO-CALLING.md §5) ────────────────────────────────────

  async mintInvite(session, { name = '' }) {
    if (!session.profileId) return null;
    // 128-bit random token, hex — the URL is the credential; single-use.
    const token = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const [row] = await db()
      .insert(contactInvites)
      .values({
        profileId: session.profileId,
        token,
        name: name.trim().slice(0, 60),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    return row ? toInvite(row) : null;
  },

  async listInvites(session) {
    if (!session.profileId) return [];
    // Active links only (unclaimed, unexpired) — claimed/expired ones are noise.
    const rows = await db()
      .select()
      .from(contactInvites)
      .where(and(eq(contactInvites.profileId, session.profileId), isNull(contactInvites.claimedBy)));
    const now = new Date();
    return rows
      .filter((r) => new Date(r.expiresAt) > now)
      .map(toInvite)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async revokeInvite(session, { id }) {
    if (!session.profileId) return;
    await db()
      .delete(contactInvites)
      .where(and(eq(contactInvites.id, id), eq(contactInvites.profileId, session.profileId)));
  },

  async claimInvite(session, { token }) {
    const d = db();
    const clean = token.trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(clean)) return null;
    const [inv] = await d.select().from(contactInvites).where(eq(contactInvites.token, clean)).limit(1);
    if (!inv) return null;
    if (session.profileId === inv.profileId) return 'own'; // she opened her own link
    if (session.profileId) return null; // professionals can't claim invites
    // Idempotent for the claimer; dead for everyone else. Expiry checked only
    // for fresh claims (a claimed link keeps routing its claimer to the thread).
    if (inv.claimedBy && inv.claimedBy !== session.accountId) return null;
    if (!inv.claimedBy && new Date(inv.expiresAt) < new Date()) return null;

    let thread = await findThread(d, inv.profileId, session.accountId);
    if (thread?.state === 'blocked') return null; // her invite never un-blocks
    if (!thread) {
      thread = await createThread(d, inv.profileId, session.accountId, 'open');
    } else if (thread.state !== 'open') {
      // pending/frozen → her invite IS the accept: open it up.
      await d.update(threads).set({ state: 'open' }).where(eq(threads.id, thread.id));
      thread = (await loadThreads(d, eq(threads.id, thread.id)))[0]!;
    }
    if (!inv.claimedBy) {
      await d
        .update(contactInvites)
        .set({ claimedBy: session.accountId, claimedAt: new Date() })
        .where(and(eq(contactInvites.id, inv.id), isNull(contactInvites.claimedBy)));
      // Auto-chat so she SEES the arrival in the thread (#9) — a system card
      // "joined via your invite link", not a silent contact-row appearance.
      await d.insert(messages).values({
        threadId: thread.id,
        sender: 'system',
        kind: 'system',
        body: 'msg_system_invite_joined',
      });
      // Her label for the link ("Mark — regular") lands in her private note so
      // she recognizes who arrived; never visible to him.
      if (inv.name) {
        await d
          .update(contacts)
          .set({ note: inv.name })
          .where(and(eq(contacts.threadId, thread.id), eq(contacts.note, '')));
      }
    }
    return thread;
  },

  async replySpeedFor(profileId): Promise<ReplySpeed | null> {
    const d = db();
    const ids = (await d.select({ id: threads.id }).from(threads).where(eq(threads.profileId, profileId))).map((r) => r.id);
    if (!ids.length) return null; // no data → honest null (no demo crutch in prod)
    const msgs = await d.select().from(messages).where(inArray(messages.threadId, ids)).orderBy(messages.createdAt);
    const byThread = new Map<string, { messages: Message[] }>();
    for (const m of msgs) (byThread.get(m.threadId) ?? byThread.set(m.threadId, { messages: [] }).get(m.threadId)!).messages.push(toMessage(m));
    return replySpeed([...byThread.values()]);
  },

  async adminListThreads(): Promise<ThreadMeta[]> {
    const d = db();
    const rows = await d
      .select({
        id: threads.id,
        profileName: profiles.name,
        profileSlug: profiles.slug,
        clientName: accounts.displayName,
        clientEmail: accounts.email,
        state: threads.state,
        lastMessageAt: threads.lastMessageAt,
        messageCount: sql<number>`(select count(*)::int from ${messages} where ${messages.threadId} = ${threads.id})`,
        hasMedia: sql<boolean>`exists (select 1 from ${messages} where ${messages.threadId} = ${threads.id} and ${messages.kind} = 'photo')`,
      })
      .from(threads)
      .innerJoin(profiles, eq(profiles.id, threads.profileId))
      .innerJoin(accounts, eq(accounts.id, threads.clientAccountId));
    return rows
      .map((r) => ({
        id: r.id,
        profileName: r.profileName,
        profileSlug: r.profileSlug,
        clientName: r.clientName ?? (r.clientEmail ?? '').split('@')[0] ?? 'Client',
        clientEmail: r.clientEmail ?? '',
        messageCount: r.messageCount,
        lastMessageAt: iso(r.lastMessageAt),
        state: r.state,
        hasMedia: r.hasMedia,
      }))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  },

  async adminGetThread(threadId) {
    return (await loadThreads(db(), eq(threads.id, threadId)))[0] ?? null;
  },

  async seedDemo(session) {
    // Hard DEV-only wall: this inserts fake client accounts and force-sets her
    // conversation mode to 'everyone' — it must NEVER run against the real DB,
    // regardless of caller.
    if (!import.meta.env.DEV) return;
    if (!session.profileId) return;
    const d = db();
    // Once per profile: skip if she already has any thread (real or seeded).
    const has = await d.select({ id: threads.id }).from(threads).where(eq(threads.profileId, session.profileId)).limit(1);
    if (has.length) return;

    // Demo counterparties — orphan client accounts (no auth user; they exist
    // only to populate her inbox for the demo). Fixed ids → idempotent.
    const demoAccounts = [
      { id: '00000000-0000-4000-d000-000000000001', name: 'Daan', email: 'daan@demo.intimate.nl' },
      { id: '00000000-0000-4000-d000-000000000002', name: 'Thomas', email: 'thomas@demo.intimate.nl' },
      { id: '00000000-0000-4000-d000-000000000003', name: 'Sven', email: 'sven@demo.intimate.nl' },
    ];
    for (const a of demoAccounts) {
      await d
        .insert(accounts)
        .values({ id: a.id, accountType: 'client', email: a.email, displayName: a.name })
        .onConflictDoNothing();
    }
    // She can receive messages while demoing.
    await d
      .insert(conversationSettings)
      .values({ profileId: session.profileId, mode: 'everyone' })
      .onConflictDoUpdate({ target: conversationSettings.profileId, set: { mode: 'everyone' } });

    const min = (n: number) => new Date(Date.now() - n * 60_000);
    const demoPhoto =
      "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='240'%20height='320'%3E%3Crect%20width='240'%20height='320'%20fill='%23c81e5a'/%3E%3Ctext%20x='120'%20y='168'%20font-size='24'%20fill='white'%20text-anchor='middle'%20font-family='sans-serif'%3EDemo%20photo%3C/text%3E%3C/svg%3E";

    type Seed = {
      account: (typeof demoAccounts)[number];
      pinned?: boolean;
      note?: string;
      mediaAllowed?: boolean;
      msgs: Array<{ sender: 'client' | 'professional' | 'system'; kind: 'text' | 'photo' | 'system'; body?: string; photo?: string; at: Date; read?: boolean }>;
    };
    const seeds: Seed[] = [
      {
        account: demoAccounts[0]!,
        msgs: [
          { sender: 'client', kind: 'text', body: 'Hi! Are you available tonight around 9?', at: min(40), read: true },
          { sender: 'professional', kind: 'text', body: 'Hi Daan! Yes, from 8pm. Where are you based?', at: min(38), read: true },
          { sender: 'client', kind: 'text', body: 'Amsterdam Zuid. How long can you do?', at: min(3) },
        ],
      },
      {
        account: demoAccounts[1]!,
        mediaAllowed: true,
        msgs: [
          { sender: 'client', kind: 'text', body: 'Hey, really loved your profile 😊', at: min(184), read: true },
          { sender: 'professional', kind: 'text', body: 'Thank you Thomas! 💋', at: min(183), read: true },
          { sender: 'system', kind: 'system', body: 'msg_system_media_on', at: min(180) },
          { sender: 'client', kind: 'photo', photo: demoPhoto, at: min(178), read: true },
          { sender: 'professional', kind: 'text', body: 'Looks great — see you Friday!', at: min(175), read: true },
        ],
      },
      {
        account: demoAccounts[2]!,
        pinned: true,
        note: 'Regular — prefers evenings, always on time.',
        msgs: [
          { sender: 'client', kind: 'text', body: 'Do you offer dinner dates?', at: min(1440), read: true },
          { sender: 'professional', kind: 'text', body: "I do! Let's arrange something next week.", at: min(1439), read: true },
        ],
      },
    ];

    for (const s of seeds) {
      const [tr] = await d
        .insert(threads)
        .values({ profileId: session.profileId, clientAccountId: s.account.id, state: 'open', lastMessageAt: s.msgs.at(-1)!.at })
        .onConflictDoNothing()
        .returning({ id: threads.id });
      if (!tr) continue;
      await d.insert(contacts).values({
        profileId: session.profileId,
        kind: 'thread',
        threadId: tr.id,
        clientAccountId: s.account.id,
        pinned: s.pinned ?? false,
        note: s.note ?? '',
        clientMediaAllowed: s.mediaAllowed ?? false,
      });
      await d.insert(messages).values(
        s.msgs.map((m) => ({
          threadId: tr.id,
          sender: m.sender,
          kind: m.kind,
          body: m.body ?? '',
          imageKey: m.photo ?? null,
          createdAt: m.at,
          readAt: m.read ? m.at : null,
        })),
      );
    }
  },
  };
}
