/**
 * The import trust boundary (src/lib/import/normalize.ts): UNTRUSTED LLM output
 * → guaranteed-valid Partial<ProfileEdit>. Getting this wrong either lets a bad
 * taxonomy value reach the DB or silently drops good data. One fixture with a
 * realistic mix of valid + junk covers the mapping, the filtering, and the
 * warnings.
 */
import { expect, test } from 'bun:test';
import { normalizeImported } from '@/lib/import/normalize';

test('keeps valid taxonomy values, drops junk, and reports it', () => {
  const { fields, warnings } = normalizeImported({
    gender: 'female',
    city: 'amsterdam',
    services: ['girlfriend_experience', 'erotic_massage', 'teleport'], // last is junk
    meetingTypes: ['incall', 'outcall'],
    languages: ['nl', 'en', 'klingon'], // last is junk
    hairColor: 'blonde',
    cupSize: 'c',
    heightCm: 170,
    weightKg: 999, // out of range → dropped
    nationality: 'RO', // uppercased → coerced to 'ro'
    phone: '+31 6 12345678',
    rates: [
      { duration: 'hour_1', incall: 150, outcall: 200 },
      { duration: 'min_30', incall: 100 },
      { label: 'phone', incall: 0 }, // no valid price → dropped
    ],
    openingHours: { mon: { allDay: true }, funday: { allDay: true } }, // funday junk
    description: 'Hallo',
  });

  expect(fields.gender).toBe('female');
  expect(fields.city).toBe('amsterdam');
  expect(fields.services).toEqual(['girlfriend_experience', 'erotic_massage']);
  expect(fields.meetingTypes).toEqual(['incall', 'outcall']);
  expect(fields.languages).toEqual(['nl', 'en']);
  expect(fields.hairColor).toBe('blonde');
  expect(fields.cupSize).toBe('c');
  expect(fields.heightCm).toBe(170);
  expect(fields.weightKg).toBeUndefined();
  expect(fields.nationality).toBe('ro');
  expect(fields.rates).toHaveLength(2);
  expect(fields.openingHours).toEqual({ mon: { closed: false, allDay: true, from: '', to: '' } });
  // never imports identity she owns
  expect('name' in fields).toBe(false);
  expect('birthDate' in fields).toBe(false);
  // junk got reported
  expect(warnings.some((w) => /service/i.test(w))).toBe(true);
  expect(warnings.some((w) => /language/i.test(w))).toBe(true);
});

test('empty / garbage input yields empty fields, no throw', () => {
  expect(normalizeImported(null).fields).toEqual({});
  expect(normalizeImported('nope').fields).toEqual({});
  expect(normalizeImported({ services: 'not-an-array' }).fields).toEqual({});
});
