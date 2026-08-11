/**
 * Agency-crawl trust boundary (src/lib/import/normalize.ts pickers + the
 * agency prompt contract): LLM output is data, never trusted (hard rule 7).
 */
import { describe, expect, test } from 'bun:test';
import { pickAgencyExtras, pickPaginationUrls, pickProfileUrls } from '@/lib/import/normalize';
import { buildExtractPrompt } from '@/lib/import/prompt';

describe('pickProfileUrls', () => {
  const base = 'https://elite-escorts.nl/dames';

  test('keeps same-site absolute + relative URLs, resolves and dedupes', () => {
    const urls = pickProfileUrls(
      {
        profileUrls: [
          'https://elite-escorts.nl/dames/eva',
          '/dames/lisa',
          'https://www.elite-escorts.nl/dames/mia',
          'https://elite-escorts.nl/dames/eva', // dupe
          'https://elite-escorts.nl/dames/eva#photos', // dupe after hash strip
        ],
      },
      base,
    );
    expect(urls).toEqual([
      'https://elite-escorts.nl/dames/eva',
      'https://elite-escorts.nl/dames/lisa',
      'https://www.elite-escorts.nl/dames/mia',
    ]);
  });

  test('drops external hosts, non-http, garbage, and the list URL itself', () => {
    const urls = pickProfileUrls(
      {
        profileUrls: [
          'https://evil.com/dames/eva',
          'javascript:alert(1)',
          'ftp://elite-escorts.nl/x',
          42,
          'not a url — but resolves relative, so kept only if same-site',
          'https://elite-escorts.nl/dames',
        ],
      },
      base,
    );
    expect(urls.every((u) => new URL(u).hostname.endsWith('elite-escorts.nl'))).toBe(true);
    expect(urls).not.toContain('https://elite-escorts.nl/dames');
    expect(urls.some((u) => u.startsWith('javascript:') || u.startsWith('ftp:'))).toBe(false);
  });

  test('non-array / missing input → empty', () => {
    expect(pickProfileUrls(null, base)).toEqual([]);
    expect(pickProfileUrls({ profileUrls: 'nope' }, base)).toEqual([]);
  });

  test('multi-part public suffix does not fail open (.co.uk base rejects apex siblings)', () => {
    const urls = pickProfileUrls(
      { profileUrls: ['https://evil.co.uk/girls/a', 'https://elite.co.uk/girls/eva', 'https://www.elite.co.uk/girls/mia'] },
      'https://elite.co.uk/girls',
    );
    expect(urls).toEqual(['https://elite.co.uk/girls/eva', 'https://www.elite.co.uk/girls/mia']);
  });
});

describe('pickPaginationUrls', () => {
  test('same-site pagination links pass; external and self are dropped', () => {
    const urls = pickPaginationUrls(
      { nextPageUrls: ['https://schipholescort.com/models/page/2/', '/models/?page=3', 'https://other.com/page/2', 'https://schipholescort.com/models/'] },
      'https://schipholescort.com/models/',
    );
    expect(urls).toEqual([
      'https://schipholescort.com/models/page/2/',
      'https://schipholescort.com/models/?page=3',
    ]);
  });

  test('missing key → empty', () => {
    expect(pickPaginationUrls({ profileUrls: ['https://x.nl/a'] }, 'https://x.nl/')).toEqual([]);
  });
});

describe('pickAgencyExtras', () => {
  test('valid identity + photos pass, junk is dropped', () => {
    const r = pickAgencyExtras({
      name: '  Eva  ',
      age: '24',
      photoUrls: ['https://cdn.site.nl/eva-1.jpg', 'javascript:x', 'https://cdn.site.nl/eva-1.jpg', 'relative.jpg', 7],
    });
    expect(r.name).toBe('Eva');
    expect(r.age).toBe(24);
    expect(r.photoUrls).toEqual(['https://cdn.site.nl/eva-1.jpg']);
  });

  test('out-of-range age and empty name are rejected, never invented', () => {
    expect(pickAgencyExtras({ name: '', age: 17 })).toEqual({ name: undefined, age: undefined, photoUrls: [] });
    expect(pickAgencyExtras({ age: 250 }).age).toBeUndefined();
    expect(pickAgencyExtras(null)).toEqual({ name: undefined, age: undefined, photoUrls: [] });
  });
});

describe('buildExtractPrompt agency mode', () => {
  test('agency keys only appear in agency mode', () => {
    const plain = buildExtractPrompt();
    const agency = buildExtractPrompt({ agency: true });
    for (const key of ['"name"', '"age"', '"photoUrls"']) {
      expect(plain).not.toContain(key);
      expect(agency).toContain(key);
    }
  });
});
