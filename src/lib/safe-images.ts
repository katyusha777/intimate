/**
 * Safe-mode placeholder images (DESIGN.md §6).
 * Deterministic pick: same key → same image, so SSR/edge-cached HTML is stable
 * and toggling never causes layout shift.
 *
 * Workers can't read the filesystem, so the list is checked in; the
 * tests/safe-images test fails if it drifts from public/safeimg/.
 */
export const SAFE_IMAGES: readonly string[] = [
  '/safeimg/100397566_p0.jpg',
  '/safeimg/100564869_p0.jpg',
  '/safeimg/103260796_p0.jpg',
  '/safeimg/103285972_p0.jpg',
  '/safeimg/103449092_p0.jpg',
  '/safeimg/103560506_p0_master1200.jpg',
  '/safeimg/109779066_p0.jpg',
  '/safeimg/113058288_p0.jpg',
  '/safeimg/117702172_p0.jpg',
  '/safeimg/117754438_p0.jpg',
  '/safeimg/124691127_p0.jpg',
  '/safeimg/144074547_p0_master1200.jpg',
  '/safeimg/144325054_p0_master1200.jpg',
  '/safeimg/60333148_p0.jpg',
  '/safeimg/69136211_p0.jpg',
  '/safeimg/69660263_p0.jpg',
  '/safeimg/69988918_p0.jpg',
  '/safeimg/71308103_p0.jpg',
  '/safeimg/71645695_p0.jpg',
  '/safeimg/72027189_p0.jpg',
  '/safeimg/72318693_p0_master1200.jpg',
  '/safeimg/73924285_p0.jpg',
  '/safeimg/74279792_p0.jpg',
  '/safeimg/76009381_p0.jpg',
  '/safeimg/76098998_p0.jpg',
  '/safeimg/76423251_p0.jpg',
  '/safeimg/76596360_p0.jpg',
  '/safeimg/78905175_p0.jpg',
  '/safeimg/78927569_p0.jpg',
  '/safeimg/79447526_p0.jpg',
  '/safeimg/80544895_p0.jpg',
  '/safeimg/82590422_p0.jpg',
  '/safeimg/84019726_p0.jpg',
  '/safeimg/84551160_p0.jpg',
  '/safeimg/85159063_p0.jpg',
  '/safeimg/93706274_p0.jpg',
  '/safeimg/94552787_p0.jpg',
  '/safeimg/95913681_p0.jpg',
  '/safeimg/97311847_p0.jpg',
  '/safeimg/98083210_p0.jpg',
];

/** FNV-1a — tiny, stable, good-enough spread for picking a placeholder. */
export function safeImageFor(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return SAFE_IMAGES[(h >>> 0) % SAFE_IMAGES.length]!;
}
