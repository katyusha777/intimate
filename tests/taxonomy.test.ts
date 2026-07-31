import { describe, expect, test } from 'bun:test';
import {
  ALL_SERVICES,
  CITIES,
  LOCALES,
  SERVICE_SYNONYMS,
} from '../src/lib/taxonomy';
import inlang from '../project.inlang/settings.json';

describe('taxonomy', () => {
  test('service values are unique across categories', () => {
    expect(new Set(ALL_SERVICES).size).toBe(ALL_SERVICES.length);
  });

  test('every synonym maps to a canonical service', () => {
    for (const [term, canonical] of Object.entries(SERVICE_SYNONYMS)) {
      expect(ALL_SERVICES as readonly string[], `synonym "${term}"`).toContain(canonical);
    }
  });

  test('city slugs are unique and url-safe', () => {
    const slugs = CITIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  test('locales match the inlang project', () => {
    expect([...inlang.locales].sort()).toEqual([...LOCALES].sort());
  });
});
