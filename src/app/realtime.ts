/**
 * Realtime seam (docs/MESSAGING.md §5, SUPABASE.md §5). Client-side only.
 *
 * `subscribe(poll, { channel })` keeps the polling shape every call site
 * already uses, but layers a Supabase private broadcast channel on top: a
 * DB-trigger broadcast (0001 `broadcast_message` → topic `thread:{id}`) fires
 * an immediate poll, so delivery is instant. The interval becomes a slow
 * safety net — if Realtime is unavailable (socket down, auth, un-provisioned
 * partitions) the poll still carries the thread. SSR-first, graceful fallback:
 * the seam never depends on the socket succeeding.
 */
import { supabaseBrowser } from '@/lib/supabase';

export function subscribe(
  poll: () => Promise<void>,
  opts: { channel?: string; intervalMs?: number } = {},
): () => void {
  // With a live channel the interval is just a safety net → slow it right down.
  const intervalMs = opts.intervalMs ?? (opts.channel ? 20_000 : 3_000);
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await poll();
    } catch {
      /* transient — next tick retries */
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer = setTimeout(tick, intervalMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      clearTimeout(timer);
      void tick(); // catch up immediately when refocused
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  const stopChannel = opts.channel ? liveChannel(opts.channel, () => void tick()) : () => {};

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    stopChannel();
  };
}

/**
 * Join a private broadcast channel; call `onEvent` on each message. Fully
 * self-healing: any failure is swallowed (the caller's interval poll is the
 * fallback). Returns a cleanup that removes the channel.
 */
function liveChannel(topic: string, onEvent: () => void): () => void {
  let removed = false;
  let teardown = () => {
    removed = true;
  };
  void (async () => {
    try {
      const supabase = supabaseBrowser();
      await supabase.realtime.setAuth(); // private channels need the session token
      if (removed) return;
      const ch = supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'message' }, () => onEvent())
        .subscribe();
      teardown = () => {
        removed = true;
        void supabase.removeChannel(ch);
      };
      if (removed) void supabase.removeChannel(ch);
    } catch {
      /* Realtime unavailable → the interval poll carries it. */
    }
  })();
  return () => teardown();
}

/**
 * Event-driven private channel (VIDEO-CALLING.md §4/§6): named-event handlers
 * plus a send() for browser-originated broadcasts (SDP/ICE signaling — the
 * "call participants send" RLS policy authorizes it). Unlike subscribe() there
 * is NO polling fallback: signaling is meaningless without the socket, so
 * failure is surfaced instead of swallowed — sends queue until the join
 * completes, results are checked (one retry), and `onStatus` tells the caller
 * when the channel is live ('ready', again after every auto-rejoin) or has
 * stopped working ('down': repeated join failures or an unexpected close).
 */
export function openChannel(
  topic: string,
  handlers: Record<string, (payload: unknown) => void>,
  onStatus?: (s: 'ready' | 'down') => void,
): { send: (event: string, payload: unknown) => void; close: () => void } {
  let closed = false;
  let ch: ReturnType<ReturnType<typeof supabaseBrowser>['channel']> | null = null;
  let failures = 0;
  const queue: Array<[string, unknown]> = [];
  const supabase = supabaseBrowser();
  const deliver = (
    c: NonNullable<typeof ch>,
    event: string,
    payload: unknown,
    retried = false,
  ): void => {
    c.send({ type: 'broadcast', event, payload })
      .then((res) => {
        if (res === 'ok' || closed) return;
        console.warn('[realtime]', topic, `send ${event}: ${res}`);
        if (!retried) setTimeout(() => deliver(c, event, payload, true), 250);
      })
      .catch(() => {});
  };
  void (async () => {
    try {
      await supabase.realtime.setAuth(); // private channels need the session token
      if (closed) return;
      // ack:true — without it send() resolves 'ok' before anything hits the
      // wire, and the retry above would be checking a meaningless value.
      let c = supabase.channel(topic, { config: { private: true, broadcast: { ack: true } } });
      for (const [event, fn] of Object.entries(handlers)) {
        c = c.on('broadcast', { event }, ({ payload }) => fn(payload));
      }
      c.subscribe((status, err) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') {
          failures = 0;
          ch = c;
          for (const [event, payload] of queue.splice(0)) deliver(c, event, payload);
          onStatus?.('ready');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // realtime-js keeps rejoining with backoff — only repeated failure
          // means the channel is genuinely dead for this session.
          console.warn('[realtime]', topic, status, err?.message ?? '');
          if (++failures >= 3) onStatus?.('down');
        } else if (status === 'CLOSED') {
          onStatus?.('down');
        }
      });
      if (closed) void supabase.removeChannel(c);
    } catch (e) {
      console.warn('[realtime]', topic, 'unavailable', e);
      onStatus?.('down');
    }
  })();
  return {
    send(event, payload) {
      if (ch) deliver(ch, event, payload);
      else queue.push([event, payload]);
    },
    close() {
      closed = true;
      const c = ch;
      ch = null;
      // Grace so the final send (the 'end' signal) flushes before the leave.
      if (c) setTimeout(() => void supabase.removeChannel(c), 500);
    },
  };
}

/**
 * Presence heartbeat (SUPABASE.md §5.4): the professional's own island touches
 * `profiles.last_active_at` on a slow cadence — an RLS-guarded, column-scoped
 * own-row update (0001 "owner heartbeat" policy + last_active_at grant). Powers
 * the `recently_online` sort + online badges. Throttled well under the Realtime
 * track limits; failures are silent (best-effort liveness).
 */
export function startHeartbeat(profileId: string, everyMs = 4 * 60_000): () => void {
  let stopped = false;
  const beat = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    try {
      await supabaseBrowser()
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', profileId); // RLS scopes this to her own row
    } catch {
      /* best-effort */
    }
  };
  void beat();
  const timer = setInterval(beat, everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
