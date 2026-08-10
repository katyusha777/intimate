/**
 * The WebRTC seam (docs/VIDEO-CALLING.md §6): trystero's production-hardened
 * peer negotiation (handshake, glare, trickle ICE, restarts, media manager)
 * joined over OUR Supabase Realtime. NOT trystero's stock supabase strategy —
 * that one builds a second anon-key client on public channels; here every
 * signaling byte rides the same authenticated browser client on the PRIVATE
 * channel `call:{sessionId}:rtc`, which the 0010 "call participants" RLS
 * policies already authorize (topic LIKE 'call:%', participant check on
 * split_part position 2). No password layer needed — RLS is the gate.
 *
 * Trystero addresses several topics per room (root announce + per-peer SDP,
 * opaque sha1 strings); all of them multiplex onto that one channel as a
 * single 'signal' broadcast event with `{t: topic, m: message}` payloads.
 * Signaling payloads are data, never instructions (hard rule 7): they go only
 * into trystero's handshake, never into the DOM.
 */
import { createTopicStrategy, type BaseRoomConfig, type StrategyMessage } from '@trystero-p2p/core';
import { supabaseBrowser } from '@/lib/supabase';

type Client = ReturnType<typeof supabaseBrowser>;
type Channel = ReturnType<Client['channel']>;

type Entry = {
  ready: Promise<Channel>;
  listeners: Map<string, Set<(msg: StrategyMessage) => void>>;
};

const entries = new Map<string, Entry>();

function entryFor(client: Client, roomId: string): Entry {
  const existing = entries.get(roomId);
  if (existing) return existing;
  const listeners: Entry['listeners'] = new Map();
  const entry: Entry = {
    listeners,
    ready: (async () => {
      await client.realtime.setAuth(); // private channels need the session token
      const ch = client
        .channel(`call:${roomId}:rtc`, {
          // ack:true — without it send() resolves 'ok' before anything hits
          // the wire and the retry in deliver() checks a meaningless value.
          config: { private: true, broadcast: { ack: true, self: false } },
        })
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          const p = payload as { t?: string; m?: StrategyMessage };
          if (!p?.t || p.m === undefined) return;
          listeners.get(p.t)?.forEach((fn) => fn(p.m!));
        });
      await new Promise<void>((resolve, reject) => {
        let failures = 0;
        ch.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[call] rtc channel', status, err?.message ?? '');
            // realtime-js keeps rejoining with backoff — only repeated failure
            // means signaling is genuinely unavailable for this session.
            if (++failures >= 3) reject(new Error('rtc signaling unavailable'));
          } else if (status === 'CLOSED') reject(new Error('rtc channel closed'));
        });
      });
      return ch;
    })(),
  };
  entries.set(roomId, entry);
  return entry;
}

function closeEntry(client: Client, roomId: string) {
  const entry = entries.get(roomId);
  if (!entry) return;
  entries.delete(roomId);
  void entry.ready.then((ch) => void client.removeChannel(ch)).catch(() => {});
}

function deliver(ch: Channel, topic: string, msg: StrategyMessage, retried = false) {
  ch.send({ type: 'broadcast', event: 'signal', payload: { t: topic, m: msg } })
    .then((res) => {
      if (res === 'ok') return;
      console.warn('[call] rtc send:', res);
      // One retry covers a transient socket blip; beyond that trystero's own
      // ~5s re-announce loop is the real recovery path.
      if (!retried) setTimeout(() => deliver(ch, topic, msg, true), 250);
    })
    .catch(() => {});
}

/** `joinCallRoom({appId, rtcConfig}, sessionId, {onJoinError})` → trystero Room. */
export const joinCallRoom = createTopicStrategy<Client, BaseRoomConfig>({
  init: () => supabaseBrowser(),

  subscribeTopic: async (client, topic, onMessage, ctx) => {
    const entry = entryFor(client, ctx.roomId);
    const fn = (msg: StrategyMessage) => void onMessage(topic, msg);
    let set = entry.listeners.get(topic);
    if (!set) entry.listeners.set(topic, (set = new Set()));
    set.add(fn);
    await entry.ready; // announce only after we can hear the reply
    return () => {
      set.delete(fn);
      if (set.size === 0) entry.listeners.delete(topic);
      if (entry.listeners.size === 0) closeEntry(client, ctx.roomId);
    };
  },

  publishTopic: async (client, topic, msg, ctx) => {
    try {
      deliver(await entryFor(client, ctx.roomId).ready, topic, msg);
    } catch {
      /* channel dead — subscribeTopic already rejected, join surfaces it */
    }
  },
});
