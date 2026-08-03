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
