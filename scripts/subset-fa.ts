/**
 * Subset the self-hosted Font Awesome woff2 files to the glyphs the app
 * actually uses (fa-thin was 402 KB for ~25 icons — ~2 s of slow-4G bandwidth
 * competing with the LCP image on every public page).
 *
 * Pristine full fonts live in public/fa/webfonts-full/ (never served); this
 * script re-subsets from those, so it is idempotent and re-runnable:
 *
 *   bun scripts/subset-fa.ts        # run after adding ANY new <Icon name>
 *
 * Icon names are discovered by scanning src/ for the three usage patterns
 * (<Icon name="x">, data `icon: 'x'`, literal `fa-x` classes), so the scan is
 * self-maintaining — but it cannot see names built at runtime from user data.
 * Keep icon names as literals in src.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import subsetFont from 'subset-font';

const ROOT = join(import.meta.dir, '..');
const FONTS = join(ROOT, 'public/fa/webfonts');
const FULL = join(ROOT, 'scripts/fa-full'); // pristine fonts — outside public/, never deployed
const CSS = readFileSync(join(ROOT, 'public/fa/css/all.min.css'), 'utf8');

// name → glyph char(s), from `.fa-heart{--fa:""}` (duotones add --fa--fa).
const glyphByName = new Map<string, string>();
for (const m of CSS.matchAll(/\.fa-([a-z0-9-]+)\{--fa:"(.+?)"/g)) {
  glyphByName.set(m[1], m[2]);
}

// Every icon-name candidate used in src/, all three patterns.
const used = new Set<string>();
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(astro|ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/name="([a-z0-9-]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/icon: ['"]([a-z0-9-]+)['"]/g)) used.add(m[1]);
  for (const m of text.matchAll(/fa-([a-z0-9-]+)/g)) used.add(m[1]);
}

const keep = [...used].filter((n) => glyphByName.has(n)).sort();
const text = keep.map((n) => glyphByName.get(n)).join('');
console.log(`keeping ${keep.length} icons: ${keep.join(' ')}`);

if (!existsSync(FULL)) mkdirSync(FULL);
for (const f of readdirSync(FONTS).filter((f) => f.endsWith('.woff2'))) {
  const pristine = join(FULL, f);
  if (!existsSync(pristine)) copyFileSync(join(FONTS, f), pristine); // first run: stash the full font
  const subset = await subsetFont(readFileSync(pristine), text, { targetFormat: 'woff2' });
  writeFileSync(join(FONTS, f), subset);
  console.log(`${f}: ${readFileSync(pristine).length} → ${subset.length} bytes`);
}
