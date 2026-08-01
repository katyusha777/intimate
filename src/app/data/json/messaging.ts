/**
 * Mock messaging backend: threads (with inline messages + contact fields) live
 * in the SESSION KV, so conversations persist across reloads in dev and on
 * staging. Participation + the client photo-grant rule are enforced HERE in
 * code — the mock stand-in for RLS. The Supabase backend (Phase 0) replaces
 * this file with threads/messages/contacts/blocks tables + RLS policies; the
 * seam (api/messaging.ts) is the switch.
 *
 * ponytail: messages are stored inline on the thread doc (fine for mock
 * volumes); split to per-message keys only if a thread ever grows huge.
 */
import { env } from 'cloudflare:workers';
import {
  ConversationSettingsSchema,
  ManualContactSchema,
  ThreadSchema,
  type ContactItem,
  type ConversationSettings,
  type ManualContact,
  type Message,
  type MessagingApi,
  type Party,
  type Thread,
  type ThreadSummary,
} from '@/app/models/messaging';
import type { Session } from '@/app/models/session';
import { profilesApi } from '@/app/data/json/profiles';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}

// djb2 → base36: a short collision-resistant suffix so two distinct emails
// can't sanitize to the same key (which would share a thread across clients).
function hash36(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const emailKey = (email: string) => {
  const e = email.toLowerCase();
  return `${e.replace(/[^a-z0-9]/g, '_')}_${hash36(e)}`;
};
const threadKey = (id: string) => `msg:thread:${id}`;
const profIndexKey = (profileId: string) => `msg:idx:prof:${profileId}`;
const clientIndexKey = (email: string) => `msg:idx:client:${emailKey(email)}`;
const settingsKey = (profileId: string) => `msg:settings:${profileId}`;
const contactsKey = (profileId: string) => `msg:contacts:${profileId}`;
const makeThreadId = (profileId: string, email: string) => `${profileId}__${emailKey(email)}`;

const now = () => new Date().toISOString();
const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function readThread(id: string): Promise<Thread | null> {
  const raw = await kv()?.get(threadKey(id));
  if (!raw) return null;
  const parsed = ThreadSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}
async function writeThread(t: Thread): Promise<void> {
  await kv()?.put(threadKey(t.id), JSON.stringify(t));
}
async function readIndex(key: string): Promise<string[]> {
  const raw = await kv()?.get(key);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
async function addToIndex(key: string, id: string): Promise<void> {
  const ids = await readIndex(key);
  if (!ids.includes(id)) await kv()?.put(key, JSON.stringify([...ids, id]));
}

/** Which side is the session on for this thread? null = not a participant. */
function partyOf(session: Session, t: Thread): Party | null {
  if (session.profileId && session.profileId === t.profileId) return 'professional';
  if (session.email.toLowerCase() === t.clientEmail.toLowerCase()) return 'client';
  return null;
}

// System cards (e.g. "photos enabled") are informational, not unread messages —
// and counting them would badge the professional for a card she triggered.
function unreadFor(t: Thread, party: Party): number {
  return t.messages.filter((msg) => msg.sender !== party && msg.sender !== 'system' && !msg.readAt)
    .length;
}

function snippetFor(t: Thread): string {
  const last = [...t.messages].reverse().find((msg) => msg.kind !== 'system');
  if (!last) return '';
  return last.kind === 'photo' ? '📷' : last.body;
}

function toSummary(t: Thread, party: Party): ThreadSummary {
  return {
    id: t.id,
    profileId: t.profileId,
    profileSlug: t.profileSlug,
    profileName: t.profileName,
    clientEmail: t.clientEmail,
    clientName: t.clientName,
    state: t.state,
    pinned: t.pinned,
    note: t.note,
    clientMediaAllowed: t.clientMediaAllowed,
    lastMessageAt: t.lastMessageAt,
    snippet: snippetFor(t),
    unread: unreadFor(t, party),
  };
}

/** Read every thread in an index that the session participates in. */
async function threadsFor(indexKey: string, session: Session): Promise<{ t: Thread; party: Party }[]> {
  const ids = await readIndex(indexKey);
  const out: { t: Thread; party: Party }[] = [];
  for (const id of ids) {
    const t = await readThread(id);
    if (!t) continue;
    const party = partyOf(session, t);
    if (party) out.push({ t, party });
  }
  return out;
}

function indexKeyFor(session: Session): string {
  return session.profileId ? profIndexKey(session.profileId) : clientIndexKey(session.email);
}

async function readManualContacts(profileId: string): Promise<ManualContact[]> {
  const raw = await kv()?.get(contactsKey(profileId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((c) => ManualContactSchema.safeParse(c)).flatMap((r) => (r.success ? [r.data] : []));
  } catch {
    return [];
  }
}

export const messagingApi: MessagingApi = {
  async settings(profileId) {
    const raw = await kv()?.get(settingsKey(profileId));
    if (!raw) {
      // ponytail: mock defaults ON so the feature is explorable out of the box.
      // Production law is default 'off' (MESSAGING.md 0.1) — the Supabase
      // backend returns 'off' here and the professional opts in.
      return ConversationSettingsSchema.parse({ mode: 'everyone' });
    }
    const parsed = ConversationSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : ConversationSettingsSchema.parse({ mode: 'everyone' });
  },

  async setMode(session, mode) {
    if (!session.profileId) return; // professionals only
    const current = await this.settings(session.profileId);
    const next: ConversationSettings = ConversationSettingsSchema.parse({ ...current, mode });
    await kv()?.put(settingsKey(session.profileId), JSON.stringify(next));
  },

  async listThreads(session) {
    const all = await threadsFor(indexKeyFor(session), session);
    return all
      .filter(({ t }) => t.state !== 'blocked')
      .map(({ t, party }) => toSummary(t, party))
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.lastMessageAt.localeCompare(a.lastMessageAt),
      );
  },

  async getThread(session, threadId) {
    const t = await readThread(threadId);
    if (!t || !partyOf(session, t)) return null; // participant-only
    return t;
  },

  async poll(session, threadId, after) {
    const t = await readThread(threadId);
    if (!t) return null;
    const party = partyOf(session, t);
    if (!party) return null;
    const messages = after ? t.messages.filter((msg) => msg.createdAt > after) : t.messages;
    // Read watermark: markRead marks all of a sender's messages at once, so the
    // latest of my read messages = how far the other side has read.
    const mine = t.messages.filter((msg) => msg.sender === party && msg.readAt);
    const readUpTo = mine.length ? mine[mine.length - 1]!.createdAt : null;
    return { messages, readUpTo, clientMediaAllowed: t.clientMediaAllowed, state: t.state };
  },

  async startThread(session, { profileSlug }) {
    if (session.profileId) return null; // clients only initiate
    const profile = await profilesApi.bySlug(profileSlug);
    if (!profile) return null;
    const settings = await this.settings(profile.id);
    if (settings.mode === 'off') return null; // her inbox, her rules
    // verified_only: mock has no client phone-verification yet — treated as
    // allowed. The Supabase policy enforces phone verification for real.

    const id = makeThreadId(profile.id, session.email);
    const existing = await readThread(id);
    if (existing) return existing;

    const ts = now();
    const t: Thread = ThreadSchema.parse({
      id,
      profileId: profile.id,
      profileSlug: profile.slug,
      profileName: profile.name,
      clientEmail: session.email,
      clientName: session.name,
      createdAt: ts,
      lastMessageAt: ts,
    });
    await writeThread(t);
    await addToIndex(profIndexKey(profile.id), id);
    await addToIndex(clientIndexKey(session.email), id);
    return t;
  },

  async send(session, { threadId, kind, body = '', photo }) {
    const t = await readThread(threadId);
    if (!t) return null;
    const party = partyOf(session, t);
    if (!party) return null;
    if (t.state === 'blocked') return null;

    if (party === 'client') {
      const settings = await this.settings(t.profileId);
      if (settings.mode === 'off') return null; // messaging paused
      // Client photo rule (MESSAGING.md 0.3 / §4): only when she granted it.
      if (kind === 'photo' && !t.clientMediaAllowed) return null;
    }

    const clean = body.trim().slice(0, 4000);
    if (kind === 'text' && !clean) return null;
    if (kind === 'photo' && !photo) return null;

    const msg: Message = {
      id: rid(),
      sender: party,
      kind,
      body: kind === 'text' ? clean : '',
      ...(kind === 'photo' ? { photo } : {}),
      createdAt: now(),
    };
    t.messages.push(msg);
    t.lastMessageAt = msg.createdAt;
    await writeThread(t);
    return msg;
  },

  async markRead(session, threadId) {
    const t = await readThread(threadId);
    if (!t) return;
    const party = partyOf(session, t);
    if (!party) return;
    let changed = false;
    const ts = now();
    for (const msg of t.messages) {
      if (msg.sender !== party && !msg.readAt) {
        msg.readAt = ts;
        changed = true;
      }
    }
    if (changed) await writeThread(t);
  },

  async setNote(session, { threadId, note }) {
    const t = await readThread(threadId);
    if (!t || partyOf(session, t) !== 'professional') return;
    t.note = note.slice(0, 500);
    await writeThread(t);
  },

  async setPinned(session, { threadId, pinned }) {
    const t = await readThread(threadId);
    if (!t || partyOf(session, t) !== 'professional') return;
    t.pinned = pinned;
    await writeThread(t);
  },

  async setMediaAllowed(session, { threadId, allowed }) {
    const t = await readThread(threadId);
    if (!t || partyOf(session, t) !== 'professional') return;
    if (t.clientMediaAllowed === allowed) return;
    t.clientMediaAllowed = allowed;
    // Granting is explained to the client with a system card; revoking is silent.
    if (allowed) {
      t.messages.push({
        id: rid(),
        sender: 'system',
        kind: 'system',
        body: 'msg_system_media_on',
        createdAt: now(),
      });
      t.lastMessageAt = now();
    }
    await writeThread(t);
  },

  async setBlocked(session, { threadId, blocked }) {
    const t = await readThread(threadId);
    if (!t) return;
    const party = partyOf(session, t);
    if (!party) return;
    if (blocked) {
      t.state = 'blocked';
      t.blockedBy = party;
    } else if (t.blockedBy === party) {
      t.state = 'open';
      t.blockedBy = undefined;
    }
    await writeThread(t);
  },

  async listBlocked(session) {
    const all = await threadsFor(indexKeyFor(session), session);
    return all
      .filter(({ t, party }) => t.state === 'blocked' && t.blockedBy === party)
      .map(({ t, party }) => toSummary(t, party));
  },

  async listContacts(session) {
    if (!session.profileId) return [];
    // Conversations become contacts automatically…
    const fromThreads: ContactItem[] = (await threadsFor(profIndexKey(session.profileId), session))
      .filter(({ t }) => t.state !== 'blocked')
      .map(({ t }) => ({
        id: t.id,
        name: t.clientName,
        note: t.note,
        handle: '',
        pinned: t.pinned,
        kind: 'thread' as const,
        threadId: t.id,
        mediaAllowed: t.clientMediaAllowed,
      }));
    // …plus manually-added address-book entries.
    const manual = await readManualContacts(session.profileId);
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
    const list = await readManualContacts(session.profileId);
    list.push(ManualContactSchema.parse({ id: rid(), name, handle, note, createdAt: now() }));
    await kv()?.put(contactsKey(session.profileId), JSON.stringify(list));
  },

  async updateContact(session, { id, name, handle = '', note = '' }) {
    if (!session.profileId) return;
    const list = await readManualContacts(session.profileId);
    const c = list.find((x) => x.id === id);
    if (!c) return;
    c.name = name;
    c.handle = handle;
    c.note = note;
    await kv()?.put(contactsKey(session.profileId), JSON.stringify(list));
  },

  async removeContact(session, { id }) {
    if (!session.profileId) return;
    const list = await readManualContacts(session.profileId);
    await kv()?.put(contactsKey(session.profileId), JSON.stringify(list.filter((c) => c.id !== id)));
  },

  async seedDemo(session) {
    if (!session.profileId) return;
    const flag = `msg:seeded:${session.profileId}`;
    if (await kv()?.get(flag)) return; // once per profile; respects later emptiness
    await kv()?.put(flag, '1');

    const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
    // Demo photo (SVG data-URL — the seed bypasses the jpeg upload validation).
    const demoPhoto =
      "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='240'%20height='320'%3E%3Crect%20width='240'%20height='320'%20fill='%23c81e5a'/%3E%3Ctext%20x='120'%20y='168'%20font-size='24'%20fill='white'%20text-anchor='middle'%20font-family='sans-serif'%3EDemo%20photo%3C/text%3E%3C/svg%3E";

    const base = {
      profileId: session.profileId,
      profileSlug: session.profileSlug ?? '',
      profileName: session.name,
    };
    const seeds: Array<Partial<Thread> & { clientEmail: string; clientName: string; messages: Message[] }> = [
      {
        clientEmail: 'daan@example.com',
        clientName: 'Daan',
        lastMessageAt: min(3),
        messages: [
          { id: rid(), sender: 'client', kind: 'text', body: 'Hi! Are you available tonight around 9?', createdAt: min(40), readAt: min(39) },
          { id: rid(), sender: 'professional', kind: 'text', body: 'Hi Daan! Yes, from 8pm. Where are you based?', createdAt: min(38), readAt: min(37) },
          { id: rid(), sender: 'client', kind: 'text', body: 'Amsterdam Zuid. How long can you do?', createdAt: min(3) }, // unread
        ],
      },
      {
        clientEmail: 'thomas@example.com',
        clientName: 'Thomas',
        clientMediaAllowed: true,
        lastMessageAt: min(175),
        messages: [
          { id: rid(), sender: 'client', kind: 'text', body: 'Hey, really loved your profile 😊', createdAt: min(184), readAt: min(183) },
          { id: rid(), sender: 'professional', kind: 'text', body: 'Thank you Thomas! 💋', createdAt: min(183), readAt: min(182) },
          { id: rid(), sender: 'client', kind: 'text', body: 'Could I send you a picture?', createdAt: min(182), readAt: min(181) },
          { id: rid(), sender: 'system', kind: 'system', body: 'msg_system_media_on', createdAt: min(180) },
          { id: rid(), sender: 'client', kind: 'photo', photo: demoPhoto, body: '', createdAt: min(178), readAt: min(177) },
          { id: rid(), sender: 'professional', kind: 'text', body: 'Looks great — see you Friday!', createdAt: min(175), readAt: min(174) },
        ],
      },
      {
        clientEmail: 'sven@example.com',
        clientName: 'Sven',
        pinned: true,
        note: 'Regular — prefers evenings, always on time.',
        lastMessageAt: min(1439),
        messages: [
          { id: rid(), sender: 'client', kind: 'text', body: 'Do you offer dinner dates?', createdAt: min(1440), readAt: min(1439) },
          { id: rid(), sender: 'professional', kind: 'text', body: "I do! Let's arrange something next week.", createdAt: min(1439), readAt: min(1438) },
        ],
      },
    ];

    for (const s of seeds) {
      const id = makeThreadId(session.profileId, s.clientEmail);
      const t = ThreadSchema.parse({
        ...base,
        ...s,
        id,
        createdAt: s.messages[0]!.createdAt,
      });
      await writeThread(t);
      await addToIndex(profIndexKey(session.profileId), id);
      await addToIndex(clientIndexKey(s.clientEmail), id);
    }
  },
};
