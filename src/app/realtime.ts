/**
 * Realtime seam (docs/MESSAGING.md §5). Client-side. Today: polling — the mock
 * has no socket. Phase 0 replaces the body with a Supabase private channel
 * (`supabase.channel('thread:{id}')` + broadcast); call sites (the thread view,
 * the inbox badge) keep the same `subscribe(poll)` shape.
 *
 * ponytail: naive fixed-interval poll; swap to Supabase Realtime when the DB
 * backend lands (no more polling, instant delivery).
 */
export function subscribe(poll: () => Promise<void>, intervalMs = 3000): () => void {
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
  // Poll faster while the tab is focused; pause when hidden (battery, MOBILE.md).
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
