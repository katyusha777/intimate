/**
 * Phantom "online now" base for the national fold count (index.astro). Early on
 * the real live set is thin; a lonely "3 nu online" reads dead. This adds a base
 * that sits around ~72–96 and drifts every few minutes, so the number feels
 * alive across refreshes, with real online profiles counted on top of it.
 *
 * Cosmetic ONLY — it never gates a shelf, a filter, or a per-profile badge.
 *
 * ponytail: vanity floor, delete once sustained real presence clears ~72.
 */
export function phantomOnlineBase(now: number = Date.now()): number {
  // New base every ~6 min: drifts over time instead of jumping on every refresh.
  const bucket = Math.floor(now / (6 * 60_000));
  // Deterministic sin-hash of the bucket → fraction in [0,1).
  const h = Math.sin(bucket * 12.9898) * 43758.5453;
  const frac = h - Math.floor(h);
  return 72 + Math.floor(frac * 25); // 72..96
}
