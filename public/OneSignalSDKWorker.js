// OneSignal's default worker path ("Typical Site" dashboard integration
// registers THIS file regardless of the SDK's serviceWorkerPath option).
// Delegate to the real app-shell worker, which importScripts the OneSignal SW —
// both script URLs are behaviorally identical, so whichever registration wins,
// push + asset caching are always both present.
importScripts('/sw.js');
