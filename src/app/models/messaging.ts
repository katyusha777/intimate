/**
 * Messaging domain (docs/MESSAGING.md): threads, messages, the professional's
 * contact fields (note / pin / photo-grant), conversation settings and blocking.
 *
 * The interface is the contract. Today a KV mock enforces participation +
 * media rules in code; the Supabase backend (Phase 0) moves those exact rules
 * into RLS and swaps only api/messaging.ts. In the mock a thread also carries
 * its contact fields inline — the same (professional, client) pair — which the
 * prod schema splits into a separate `contacts` table.
 */
import { z } from 'zod';
import { CONVERSATION_MODES, MESSAGE_KINDS, THREAD_STATES } from '@/lib/taxonomy';
import type { Session } from '@/app/models/session';

/** Which side of a thread the viewer is — decided from the session, never trusted from input. */
export type Party = 'professional' | 'client';

export const MessageSchema = z.object({
  id: z.string(),
  sender: z.enum(['professional', 'client', 'system']),
  kind: z.enum(MESSAGE_KINDS),
  /** text body, or the i18n key for a system card. */
  body: z.string().default(''),
  /** photo kind: data-URL in the mock; signed Cloudflare Images ref in prod. */
  photo: z.string().optional(),
  createdAt: z.string(),
  readAt: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationSettingsSchema = z.object({
  mode: z.enum(CONVERSATION_MODES).default('off'),
  allowCallRequests: z.boolean().default(true),
});
export type ConversationSettings = z.infer<typeof ConversationSettingsSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  profileSlug: z.string(),
  profileName: z.string(),
  clientEmail: z.string(),
  clientName: z.string(),
  state: z.enum(THREAD_STATES).default('open'),
  /** Set when state=blocked, so each side sees its own block list. */
  blockedBy: z.enum(['professional', 'client']).optional(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  // --- contact fields (professional's CRM; prod = `contacts` row) ---
  pinned: z.boolean().default(false),
  /** Private to her (never leaves the professional side). */
  note: z.string().max(500).default(''),
  /** Her per-client photo grant (MESSAGING.md 0.3 / §4). */
  clientMediaAllowed: z.boolean().default(false),
  messages: z.array(MessageSchema).default([]),
});
export type Thread = z.infer<typeof ThreadSchema>;

/** Inbox/contact row — a thread without its full message log. */
export interface ThreadSummary {
  id: string;
  profileId: string;
  profileSlug: string;
  profileName: string;
  clientEmail: string;
  clientName: string;
  state: Thread['state'];
  pinned: boolean;
  note: string;
  clientMediaAllowed: boolean;
  lastMessageAt: string;
  snippet: string;
  unread: number;
}

/** A manually-added contact (no conversation needed) — her address book. */
export const ManualContactSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  /** Phone or email, freeform (how she'd reach them). */
  handle: z.string().trim().max(120).default(''),
  note: z.string().max(500).default(''),
  createdAt: z.string(),
});
export type ManualContact = z.infer<typeof ManualContactSchema>;

/** Unified contact row for the CRM: either a conversation or an address-book entry. */
export interface ContactItem {
  id: string;
  name: string;
  note: string;
  /** phone/email for manual entries; '' for conversation-derived ones. */
  handle: string;
  pinned: boolean;
  kind: 'thread' | 'manual';
  threadId?: string;
  mediaAllowed?: boolean;
}

/**
 * Measured reply speed (UX-PLAN 3.2): the review-free trust signal. From each
 * thread take the first client→professional first-reply latency (the client's
 * first message → her first message after it), keep only replies inside the
 * rolling window, and return the MEDIAN — but ONLY when the sample is honest.
 *
 * `null` below the threshold is load-bearing: a stat computed from 1–4 replies
 * is noise dressed as a promise, so we show nothing rather than fabricate. Pure
 * over thread data (no KV) so it's the same helper the SQL view replaces later.
 */
export const REPLY_SPEED_SAMPLE_MIN = 5;
export const REPLY_SPEED_WINDOW_DAYS = 30;

export interface ReplySpeed {
  medianMinutes: number;
  sampleSize: number;
}

export function replySpeed(
  threads: readonly Pick<Thread, 'messages'>[],
  now: Date = new Date(),
  windowDays = REPLY_SPEED_WINDOW_DAYS,
): ReplySpeed | null {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const latencies: number[] = [];

  for (const t of threads) {
    const firstClient = t.messages.find((msg) => msg.sender === 'client');
    if (!firstClient) continue;
    const reply = t.messages.find(
      (msg) => msg.sender === 'professional' && msg.createdAt > firstClient.createdAt,
    );
    if (!reply) continue;
    const repliedAt = new Date(reply.createdAt).getTime();
    if (repliedAt < cutoff) continue; // rolling window on the reply moment
    const mins = (repliedAt - new Date(firstClient.createdAt).getTime()) / 60_000;
    if (mins >= 0) latencies.push(mins);
  }

  if (latencies.length < REPLY_SPEED_SAMPLE_MIN) return null;
  latencies.sort((a, b) => a - b);
  const mid = latencies.length >> 1;
  const median =
    latencies.length % 2 ? latencies[mid]! : (latencies[mid - 1]! + latencies[mid]!) / 2;
  return { medianMinutes: Math.round(median), sampleSize: latencies.length };
}

/** Thread metadata for admin oversight (§9) — unrestricted; content is governed. */
export interface ThreadMeta {
  id: string;
  profileName: string;
  profileSlug: string;
  clientName: string;
  clientEmail: string;
  messageCount: number;
  lastMessageAt: string;
  state: Thread['state'];
  hasMedia: boolean;
}

export interface MessagingApi {
  settings(profileId: string): Promise<ConversationSettings>;
  setMode(session: Session, mode: ConversationSettings['mode']): Promise<void>;

  listThreads(session: Session): Promise<ThreadSummary[]>;
  /** Participant-only (mock stand-in for RLS); non-participant → null. */
  getThread(session: Session, threadId: string): Promise<Thread | null>;
  /**
   * Realtime poll payload (§5). Deliberately minimal + client-safe: only
   * messages newer than `after`, the viewer's own read-watermark, the photo
   * grant and thread state. NEVER the professional's private note/pin — those
   * must not reach the client (0.3 / §4).
   */
  poll(
    session: Session,
    threadId: string,
    after?: string,
  ): Promise<{
    messages: Message[];
    readUpTo: string | null;
    clientMediaAllowed: boolean;
    state: Thread['state'];
  } | null>;
  /** Client-only, idempotent get-or-create for (profile, client). */
  startThread(session: Session, input: { profileSlug: string }): Promise<Thread | null>;
  send(
    session: Session,
    input: { threadId: string; kind: 'text' | 'photo'; body?: string; photo?: string },
  ): Promise<Message | null>;
  markRead(session: Session, threadId: string): Promise<void>;

  // contact ops — professional side only
  setNote(session: Session, input: { threadId: string; note: string }): Promise<void>;
  setPinned(session: Session, input: { threadId: string; pinned: boolean }): Promise<void>;
  setMediaAllowed(session: Session, input: { threadId: string; allowed: boolean }): Promise<void>;

  // blocking — either side, bidirectional effect
  setBlocked(session: Session, input: { threadId: string; blocked: boolean }): Promise<void>;
  listBlocked(session: Session): Promise<ThreadSummary[]>;

  // contacts CRM — professional's address book (conversations + manual entries)
  listContacts(session: Session): Promise<ContactItem[]>;
  addContact(session: Session, input: { name: string; handle?: string; note?: string }): Promise<void>;
  updateContact(
    session: Session,
    input: { id: string; name: string; handle?: string; note?: string },
  ): Promise<void>;
  removeContact(session: Session, input: { id: string }): Promise<void>;

  /**
   * Measured reply speed for a profile (UX-PLAN 3.2), or null below the honest
   * sample threshold. Reads that profile's threads; mock now, SQL view later.
   */
  replySpeedFor(profileId: string): Promise<ReplySpeed | null>;

  /** Demo only: seed a professional's empty inbox with sample threads (once). */
  seedDemo(session: Session): Promise<void>;

  // --- admin oversight (ADMIN.md §9). Governance (roles, audit, report-scoping)
  // is enforced in the admin action; these are the raw reads it guards.
  adminListThreads(): Promise<ThreadMeta[]>;
  adminGetThread(threadId: string): Promise<Thread | null>;
}
