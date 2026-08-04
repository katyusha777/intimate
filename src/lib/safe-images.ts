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

/**
 * NSFW imagery served when safe mode is OFF and no real photo exists yet
 * (dummy-data phase). Same deterministic pick, own pool (public/nsfwimg/).
 */
export const NSFW_IMAGES: readonly string[] = [
  '/nsfwimg/agung-setiawan-uqIQkQE0gtM-unsplash.jpg',
  '/nsfwimg/andrey-zvyagintsev-PsreHGlHZJ8-unsplash.jpg',
  '/nsfwimg/anil-sharma-bzjVTQMMm-U-unsplash.jpg',
  '/nsfwimg/ayo-ogunseinde-LX_nAdJQpAQ-unsplash.jpg',
  '/nsfwimg/babi-JztG86OFVKo-unsplash.jpg',
  '/nsfwimg/babi-Lf9JpqXS--0-unsplash.jpg',
  '/nsfwimg/brian-lawson-GHFQL3sLfyQ-unsplash.jpg',
  '/nsfwimg/brian-lawson-MRRgFUt3V0Q-unsplash.jpg',
  '/nsfwimg/brian-lawson-P0w6oSpzYv0-unsplash.jpg',
  '/nsfwimg/brian-wangenheim-wX-LgYYQXXA-unsplash.jpg',
  '/nsfwimg/caique-nascimento-Ij24Uq1sMwM-unsplash.jpg',
  '/nsfwimg/cucu-marius-daniel-KYr4v51hRqU-unsplash.jpg',
  '/nsfwimg/ernest-tarasov-fNuQAdvynBQ-unsplash.jpg',
  '/nsfwimg/felix-uresti-ZPOZsEuNhgo-unsplash.jpg',
  '/nsfwimg/garin-chadwick-XNf_s_upjso-unsplash.jpg',
  '/nsfwimg/gold-touch-nutrition-895Q_xZU4js-unsplash.jpg',
  '/nsfwimg/jeferson-gomes-9crthglc2ZE-unsplash.jpg',
  '/nsfwimg/jeferson-gomes-GYaEMfwk5pM-unsplash.jpg',
  '/nsfwimg/josh-pereira-MMCbN2qBEJM-unsplash.jpg',
  '/nsfwimg/joshua-rawson-harris-0SRum07agS0-unsplash.jpg',
  '/nsfwimg/logan-weaver-lgnwvr-DFOqZDsIaUA-unsplash.jpg',
  '/nsfwimg/marlon-alves-XIPHPLurLWc-unsplash.jpg',
  '/nsfwimg/martin-martz-Mii2BAuPADw-unsplash.jpg',
  '/nsfwimg/mihaela-claudia-puscas-P6ug7DiWzZ8-unsplash.jpg',
  '/nsfwimg/mukul-kumar-oWfo8H7wvWo-unsplash.jpg',
  '/nsfwimg/ph-m-duy-quang-8JJVTvNh4Cs-unsplash.jpg',
  '/nsfwimg/siednji-leon-VKGNDoJXNQY-unsplash.jpg',
  '/nsfwimg/vadim-yefremov-PZJAYsy4Uao-unsplash.jpg',
  '/nsfwimg/vasi-AfcSlj6c0pU-unsplash.jpg',
  '/nsfwimg/viktor-hesse-AIa89vmqZSA-unsplash.jpg',
];

/** FNV-1a — tiny, stable, good-enough spread for picking a placeholder. */
function fnv(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * NEUTRAL placeholder set (Phase 5 — the discretion kit). Genuinely boring:
 * muted, abstract, gallery-wall gradients so a wall of them draws no glance.
 * Generated deterministically as inline SVG data-URIs (no files, no test drift)
 * — same deterministic-by-key mechanism as the image sets above, so SSR/edge
 * cache stays stable and toggling never shifts layout.
 *
 * Palette = desaturated stone/greige tones that read as neutral wall art in
 * both themes. The `dev` (anime) set stays the operator's build-in-public skin.
 */
const NEUTRAL_TONES: readonly [string, string][] = [
  ['#d9d6d0', '#b7b2a8'], // warm stone
  ['#cfd2d4', '#a9adb1'], // cool grey
  ['#d6d1cc', '#b0a79c'], // greige
  ['#c9cdcb', '#a3a8a4'], // sage grey
  ['#d3cfd2', '#aca6ad'], // muted mauve
  ['#cdd0d6', '#a4a8b2'], // slate
  ['#d8d4cd', '#bbb3a5'], // sand
  ['#c8ccce', '#9fa4a7'], // ash
];

/** Deterministic muted-gradient SVG for a key, as a data-URI. */
export function neutralImageFor(key: string): string {
  const h = fnv(key);
  const [a, b] = NEUTRAL_TONES[h % NEUTRAL_TONES.length]!;
  const angle = (h >> 3) % 180; // stable per-key gradient direction
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='533' viewBox='0 0 400 533'>` +
    `<defs><linearGradient id='g' gradientTransform='rotate(${angle} .5 .5)'>` +
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
    `</linearGradient></defs><rect width='400' height='533' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function safeImageFor(key: string): string {
  return SAFE_IMAGES[fnv(key) % SAFE_IMAGES.length]!;
}

export function nsfwImageFor(key: string): string {
  return NSFW_IMAGES[fnv(key) % NSFW_IMAGES.length]!;
}
