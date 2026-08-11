/**
 * Generate the hosted PNG assets for the admin email-signature builder
 * (src/pages/admin/tools). Email clients (Gmail especially) strip SVG, so the
 * signature can only reference raster images at absolute URLs — these land in
 * public/img/signature/ and serve at https://intimate.nl/img/signature/*.png.
 *
 * Bun/sharp are toolchain-only (scripts/), never shipped to the worker.
 * Re-run when the brand mark or an icon glyph changes:  bun scripts/gen-signature-assets.ts
 */
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BRAND = '#d50323';
const OUT = join(import.meta.dir, '../public/img/signature');

// 24×24 white glyphs (Material call/email + send paper-plane). WhatsApp comes
// from simple-icons (CC0) at build below — its silhouette reads white-on-red.
const GLYPHS: Record<string, string> = {
  phone:
    'M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  email:
    'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
  telegram: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
};

/** brand-red disc + centred white glyph → crisp @4x PNG (displayed at 22px). */
async function chip(name: string, glyphPath: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="${BRAND}"/><g transform="translate(10 10)"><path d="${glyphPath}" fill="#ffffff"/></g></svg>`;
  await sharp(Buffer.from(svg)).resize(88, 88).png().toFile(join(OUT, `${name}.png`));
}

function pathFromSvg(svg: string): string {
  const m = svg.match(/ d="([^"]+)"/);
  if (!m) throw new Error('no path in svg');
  return m[1];
}

await mkdir(OUT, { recursive: true });

for (const [name, d] of Object.entries(GLYPHS)) await chip(name, d);

// WhatsApp glyph (simple-icons, saved to scratchpad).
const waSvg = await readFile(
  '/private/tmp/claude-501/-Users-katyusha-Code-intimate/55e9cc6d-903f-4df7-8f2e-ae337974f606/scratchpad/whatsapp.svg',
  'utf8',
);
await chip('whatsapp', pathFromSvg(waSvg));

// Brand wordmark ("intimate" script + lips). logo-DARK = dark ink for light
// backgrounds — the signature sits on white. Retina 2× (96px tall), transparent,
// margins trimmed. (logo-light is the white-ink version for dark backgrounds.)
const logo = await readFile(join(import.meta.dir, '../public/img/logo-dark.svg'));
await sharp(logo, { density: 384 })
  .resize({ height: 96 })
  .trim()
  .png()
  .toFile(join(OUT, 'logo.png'));

const files = ['phone', 'email', 'telegram', 'whatsapp', 'logo'].map((n) => `${n}.png`);
console.log('wrote', files.join(', '), '→ public/img/signature/');
