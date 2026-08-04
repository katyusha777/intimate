/**
 * Docs consistency (CLAUDE.md "Docs discipline"): the docs ARE the spec the
 * next session builds from, so drift is a bug that fails the build, not a
 * cleanup chore. Three walls:
 *   1. every `X.md` cross-reference points to a file that exists;
 *   2. superseded facts (banned strings) cannot reappear;
 *   3. COMPONENTS.md's inventory matches the actual component tree, both ways.
 */
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = 'docs';
const docs = new Map<string, string>(
  readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => [f, readFileSync(join(DOCS_DIR, f), 'utf8')]),
);
docs.set('CLAUDE.md', readFileSync('CLAUDE.md', 'utf8'));

// 1 ── every UPPERCASE.md reference resolves to a real file (docs/ or root)
test('doc cross-references point to files that exist', () => {
  const missing: string[] = [];
  for (const [file, text] of docs) {
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9-]*\.md)\b/g)) {
      const ref = m[1];
      if (!docs.has(ref) && !existsSync(join(DOCS_DIR, ref)) && !existsSync(ref)) {
        missing.push(`${file} → ${ref}`);
      }
    }
  }
  expect(missing).toEqual([]);
});

// 2 ── superseded facts stay dead. A hit means a stale claim crept back in;
// fix the text (or, if policy really changed, update the owning doc AND here).
const BANNED: Array<[name: string, re: RegExp, allowedIn: string[]]> = [
  // hard rule 3 is bounded retention now, not instant deletion
  ['instant-deletion claim', /deleted after review|deleted immediately/i, []],
  // docs/PLAN.md was folded into CLAUDE.md/ARCHITECTURE.md long ago
  ['dead PLAN.md reference', /docs\/PLAN\.md|\bper PLAN\b|\(PLAN non-negotiable/, []],
  // Twilio auth is API key SID/secret (VERIFICATION.md §1)
  ['old Twilio credential names', /TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN/, []],
  // icons are self-hosted Font Awesome via atoms/Icon (INFRASTRUCTURE.md §4)
  ['lucide icon reference', /lucide/i, []],
  // error tracking is PostHog; "Sentry" may appear only where the no-Sentry
  // decision itself is documented
  ['stray Sentry reference', /Sentry/, ['ANALYTICS.md', 'ADMIN.md', 'CLAUDE.md']],
];

for (const [name, re, allowedIn] of BANNED) {
  test(`no ${name} in docs`, () => {
    const offenders = [...docs]
      .filter(([file, text]) => !allowedIn.includes(file) && re.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
}

// 3 ── COMPONENTS.md inventory truth, both directions
const componentsMd = docs.get('COMPONENTS.md')!;
const COMP = 'src/components';

test('every existing atom/molecule/organism is mentioned in COMPONENTS.md', () => {
  const unmentioned: string[] = [];
  for (const level of ['atoms', 'molecules'] as const) {
    for (const f of readdirSync(join(COMP, level))) {
      const stem = f.replace(/\.(astro|tsx)$/, '');
      if (!componentsMd.includes(stem)) unmentioned.push(`${level}/${stem}`);
    }
  }
  for (const domain of readdirSync(join(COMP, 'organisms'))) {
    for (const f of readdirSync(join(COMP, 'organisms', domain))) {
      const stem = f.replace(/\.(astro|tsx)$/, '');
      if (!componentsMd.includes(stem)) unmentioned.push(`organisms/${domain}/${stem}`);
    }
  }
  expect(unmentioned).toEqual([]);
});

test('every ✓-marked organism in the COMPONENTS.md domain map exists on disk', () => {
  const missing: string[] = [];
  for (const m of componentsMd.matchAll(/^\| `(\w+)\/` \| ✓ ([^|]+)\|/gm)) {
    const domain = m[1];
    const builtPart = m[2].split('—')[0]; // names after "—" are anticipated
    for (const raw of builtPart.split(',')) {
      const name = raw.replace(/\(.*?\)/g, '').trim();
      if (!name) continue;
      if (!existsSync(join(COMP, 'organisms', domain, `${name}.astro`)) &&
          !existsSync(join(COMP, 'organisms', domain, `${name}.tsx`))) {
        missing.push(`${domain}/${name}`);
      }
    }
  }
  expect(missing).toEqual([]);
});

// 4 ── temporary trackers keep their delete-when-done marker
test('temporary trackers carry their deletion marker', () => {
  for (const tracker of ['SEO-BUILD.md', 'UX-PLAN.md']) {
    const text = docs.get(tracker);
    if (text === undefined) continue; // deleted on completion — exactly the plan
    expect(text.toLowerCase()).toContain('delete');
  }
});
