/** SEO invariants (SEO.md §1/§2/§10). */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { LISTING_CATEGORIES, LOCALES } from '../src/lib/taxonomy';
import { negotiateLocale } from '../src/lib/i18n';

test('robots.txt allows every AI + classic crawler', () => {
  const robots = readFileSync('public/robots.txt', 'utf8');
  for (const bot of [
    'Googlebot',
    'Bingbot',
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-SearchBot',
    'anthropic-ai',
    'PerplexityBot',
    'Brave',
  ]) {
    const section = robots.split(`User-agent: ${bot}`)[1]?.split('User-agent:')[0] ?? '';
    expect(section.includes('Allow: /'), `${bot} must be allowed`).toBe(true);
    expect(section.includes('Disallow: /\n'), `${bot} must not be blanket-disallowed`).toBe(false);
  }
  expect(robots).toContain('Sitemap:');
});

test('every listing category has a unique slug per locale', () => {
  for (const locale of LOCALES) {
    const slugs = LISTING_CATEGORIES.map((c) => c.slugs[locale]);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  }
});

test('category slugs never collide with city slugs (route ambiguity)', async () => {
  const { CITIES } = await import('../src/lib/taxonomy');
  const citySlugs = new Set<string>(CITIES.map((c) => c.slug));
  for (const locale of LOCALES) {
    for (const cat of LISTING_CATEGORIES) {
      expect(citySlugs.has(cat.slugs[locale]), `${cat.slugs[locale]} collides with a city`).toBe(
        false,
      );
    }
  }
});

test('locale negotiation: match order, fallback en', () => {
  expect(negotiateLocale('nl-NL,nl;q=0.9,en;q=0.8')).toBe('nl');
  expect(negotiateLocale('de-DE,de;q=0.9')).toBe('de');
  expect(negotiateLocale('fr-FR,fr;q=0.9')).toBe('en');
  expect(negotiateLocale(null)).toBe('en');
});
