/**
 * The site-neutrality law (decision 2026-08-14): lib/import/prompt.ts is the
 * shared SCHEMA CONTRACT — identical for every source site. Everything a
 * specific provider's site needs lives in orgs.site_prompt (one prompt per
 * provider, DB data, admin-edited). A provider name or provider vocabulary
 * appearing in the shared files is a regression toward the god-prompt.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildExtractPrompt, withSitePrompt } from '@/lib/import/prompt';

// Provider names + provider-specific page vocabulary seen so far. Grow this
// list when onboarding a provider tempts someone to teach the shared contract
// its words — the temptation is the bug.
const FORBIDDEN = /\bkim\b|kimnl|schiphol|beschikbaar|afwezig|carousel|koestraat|masseuse|\/dames\//i;

test('shared crawl files contain no provider names or vocabulary', () => {
  for (const f of ['src/lib/import/prompt.ts', 'src/lib/import/agency.ts']) {
    expect(readFileSync(f, 'utf8')).not.toMatch(FORBIDDEN);
  }
  expect(buildExtractPrompt({ agency: true, today: '2026-08-14' })).not.toMatch(FORBIDDEN);
});

test('withSitePrompt appends the provider prompt verbatim after the contract', () => {
  const out = withSitePrompt('CONTRACT', 'THIS SITE marks free days with a purple widget');
  expect(out.startsWith('CONTRACT')).toBe(true);
  expect(out).toContain('THIS SITE marks free days with a purple widget');
  expect(withSitePrompt('CONTRACT')).toBe('CONTRACT');
  expect(withSitePrompt('CONTRACT', '  ')).toBe('CONTRACT');
});

test('the contract lists every schema key, availabilityDates included, neutrally', () => {
  const p = buildExtractPrompt({ agency: true, today: '2026-08-14' });
  for (const k of ['"name"', '"age"', '"ageText"', '"photoUrls"', '"services"', '"openingHours"', '"availabilityDates"', '"rates"', '"city"']) {
    expect(p).toContain(k);
  }
  // Self-service never gets identity keys.
  const selfService = buildExtractPrompt();
  expect(selfService).not.toContain('"ageText"');
  expect(selfService).not.toContain('"photoUrls"');
});
