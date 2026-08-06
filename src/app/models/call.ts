/**
 * Calls domain (docs/VIDEO-CALLING.md): 1:1 WebRTC call session metadata and
 * the server-side state machine. Media is P2P — this model never carries SDP,
 * ICE, or content; signaling rides the realtime `call:{id}` topic and is never
 * persisted.
 */
import { z } from 'zod';
import { CALL_MODES, CALL_STATES, type CallState } from '@/lib/taxonomy';
import type { Session } from '@/app/models/session';

export const CallViewSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  mode: z.enum(CALL_MODES),
  state: z.enum(CALL_STATES),
  /** Which side the SESSION is — decided server-side, never trusted from input. */
  party: z.enum(['professional', 'client']),
  /** Display identity of the OTHER side (overlay/screen header). */
  peerName: z.string(),
  /** Her profile id — the callee overlay's avatar key. */
  profileId: z.string(),
  /** Her first approved public photo (the ring overlay's face) — served URL. */
  avatarUrl: z.string().optional(),
  startedAt: z.iso.datetime(),
  answeredAt: z.iso.datetime().optional(),
});
export type CallView = z.infer<typeof CallViewSchema>;

/** Ring window before a caller-side timeout → 'timeout' (“missed”). */
export const RING_TIMEOUT_MS = 30_000;
/** Active-call heartbeat cadence (last_beat_at — liveness now, billing later). */
export const CALL_BEAT_MS = 30_000;

/**
 * The legal transitions — the ONE place the state machine lives (call_sessions
 * has no browser write path, so the action layer enforcing this IS the wall).
 */
const LEGAL: Record<CallState, readonly CallState[]> = {
  ringing: ['active', 'declined', 'timeout', 'failed'],
  active: ['ended', 'failed'],
  ended: [],
  declined: [],
  timeout: [],
  failed: [],
};

export function canTransition(from: CallState, to: CallState): boolean {
  return LEGAL[from].includes(to);
}

/** Terminal states post a `kind='call'` card into the thread (body = i18n key). */
export const CALL_CARD_BODY: Partial<Record<CallState, string>> = {
  ended: 'call_card_ended',
  declined: 'call_card_declined',
  timeout: 'call_card_missed',
  failed: 'call_card_failed',
};

export interface CallsApi {
  /**
   * Professional-only (product law 0.2 — the DB CHECK is the backstop): start
   * ringing the thread's client. 'busy' = she already has a live session.
   * null = not hers / thread not open / her mode off / blocked.
   */
  start(
    session: Session,
    input: { threadId: string; mode: 'voice' | 'video' },
  ): Promise<CallView | 'busy' | null>;
  /** Participant view of a session (callee overlay, reconnect) — else null. */
  get(session: Session, callId: string): Promise<CallView | null>;
  /** Client answers the ring (ringing → active). */
  accept(session: Session, callId: string): Promise<boolean>;
  /** Client declines the ring (ringing → declined; posts the card). */
  decline(session: Session, callId: string): Promise<boolean>;
  /**
   * Either side finishes: active → ended (duration + card) · ringing →
   * timeout|failed by `reason` (caller gave up / connection never made it).
   */
  end(session: Session, input: { callId: string; reason: 'hangup' | 'timeout' | 'failed' }): Promise<boolean>;
  /** Active-call heartbeat (participant): stamps last_beat_at. */
  beat(session: Session, callId: string): Promise<void>;
}
