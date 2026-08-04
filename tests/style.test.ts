/**
 * Style cohesion rules (DESIGN.md §2.6): spacing and typography come from the
 * scale and role utilities — arbitrary values are how cohesion dies, so they
 * fail the build. Sanctioned escape hatches: add a token to global.css
 * (`--text-2xs`, `--tracking-eyebrow` are precedents), never a bracket value.
 *
 * Deliberately NOT policed: dimensions (w/h/min-h), grid templates,
 * percentages, `env(...)` insets — those are layout, not rhythm.
 */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'paraglide' || name === 'ui') return []; // generated / vendor
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(astro|tsx)$/.test(name) ? [p] : [];
  });
}

const files = walk('src');

const BANNED: Array<[name: string, re: RegExp]> = [
  // arbitrary numeric margins/padding/gaps: p-[13px], mt-[7px], gap-[18px], -mx-[2px]…
  ['arbitrary spacing', /(?:^|[\s'"`])-?(?:m|p)[tbrlxy]?-\[\.?\d|(?:^|[\s'"`])(?:gap(?:-[xy])?|space-[xy])-\[\.?\d/],
  // arbitrary font sizes: text-[15px], text-[0.8rem]
  ['arbitrary font size', /(?:^|[\s'"`])text-\[\.?\d/],
  // arbitrary tracking/leading: tracking-[0.14em], leading-[1.15]
  ['arbitrary tracking/leading', /(?:^|[\s'"`])(?:tracking|leading)-\[/],
];

for (const [name, re] of BANNED) {
  test(`no ${name} values in class names`, () => {
    const offenders = files.filter((f) => re.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
}
