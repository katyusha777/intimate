/**
 * Enforces the atomic component architecture (docs/COMPONENTS.md):
 *   ui (vendor) < atoms < molecules < organisms < layouts/pages
 * - `components/ui/` may only be imported from `components/atoms/`
 * - imports never point upward (an atom can't import a molecule, etc.)
 * - no loose component files in `src/components/` root
 */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LEVELS: Record<string, number> = {
  ui: 0,
  atoms: 1,
  molecules: 2,
  organisms: 3,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'paraglide') return []; // generated
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(astro|ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Level of a file path, or Infinity for layouts/pages/lib (top consumers). */
function levelOf(path: string): number {
  const match = path.match(/src\/components\/([^/]+)\//);
  if (!match) return Infinity;
  return LEVELS[match[1]!] ?? Infinity;
}

const files = walk('src');

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/from\s+['"](@\/[^'"]+)['"]/g)].map(([, spec]) => spec!);
}

test('components/ui is only imported by atoms', () => {
  const offenders = files
    .filter((f) => !f.includes('components/ui/') && !f.includes('components/atoms/'))
    .filter((f) => importsOf(f).some((spec) => spec.startsWith('@/components/ui/')));
  expect(offenders).toEqual([]);
});

test('imports never point upward in the atomic hierarchy', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const myLevel = levelOf(f);
    for (const spec of importsOf(f)) {
      const target = spec.match(/^@\/components\/([^/]+)\//)?.[1];
      if (!target) continue; // lib/models/paraglide etc. are level-free
      const targetLevel = LEVELS[target] ?? Infinity;
      if (targetLevel > myLevel) offenders.push(`${f} -> ${spec}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('no loose files in src/components root', () => {
  const loose = readdirSync('src/components').filter((n) =>
    statSync(join('src/components', n)).isFile(),
  );
  expect(loose).toEqual([]);
});

// --- app data layer seams (docs/API.md) ---

test('app/data backends are only reachable through the api seam', () => {
  const offenders = files
    .filter((f) => !f.includes('src/app/api/') && !f.includes('src/app/data/'))
    .filter((f) => importsOf(f).some((spec) => spec.startsWith('@/app/data/')));
  expect(offenders).toEqual([]);
});

test('app/api is only called from pages, layouts, actions and the middleware', () => {
  // middleware.ts joined 2026-08-23: advertiser focus-mode reads the session
  // seam (memoized — the page's own read reuses it) to gate product pages.
  const allowed = ['src/pages/', 'src/layouts/', 'src/actions/', 'src/app/api/', 'src/middleware.ts'];
  const offenders = files
    .filter((f) => !allowed.some((a) => f.includes(a)))
    .filter((f) => importsOf(f).some((spec) => spec.startsWith('@/app/api/')));
  expect(offenders).toEqual([]);
});

// --- admin fence (docs/ADMIN.md §1) ---

const ADMIN_FENCE = ['src/pages/admin/', 'src/actions/admin/', 'src/components/organisms/admin/'];
const ADMIN_SPECS = ['@/actions/admin', '@/pages/admin', '@/components/organisms/admin'];

test('nothing outside the admin fence imports admin code', () => {
  // The action registry is the ONE sanctioned cross-fence import (it must wire
  // admin actions into the app action tree).
  const registry = 'src/actions/index.ts';
  const offenders = files
    .filter((f) => !ADMIN_FENCE.some((a) => f.includes(a)) && !f.endsWith(registry))
    .filter((f) => importsOf(f).some((spec) => ADMIN_SPECS.some((a) => spec.startsWith(a))));
  expect(offenders).toEqual([]);
});

test('the Supabase service-role client is constructed only inside the admin fence', () => {
  // Grep guard (ADMIN.md §1): no service-role key/client leaks outside admin.
  const offenders = files
    .filter((f) => !ADMIN_FENCE.some((a) => f.includes(a)))
    .filter((f) => /service_role|SERVICE_ROLE/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
