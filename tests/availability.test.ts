/**
 * availabilityState (UX-PLAN 1.3) — the one honest-shelf helper. Hand-computed
 * fixtures across the online / open-today / back-later edges, in the market's
 * timezone (Europe/Amsterdam). If this drifts, every card lies.
 */
import { expect, test } from 'bun:test';
import {
  availabilityRank,
  availableNow,
  availabilityState,
  ProfileSchema,
} from '@/app/models/profile';

const base = ProfileSchema.parse({
  id: 'pT',
  slug: 't',
  state: 'live',
  name: 'T',
  birthDate: '2000-01-01',
  gender: 'female',
  city: 'amsterdam',
  verified: true,
  online: false,
  featured: false,
  priceFrom: 100,
  services: [],
  meetingTypes: ['incall'],
  openingHours: {},
  description: '',
  photos: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});

// A Wednesday, 12:00 UTC = 14:00 in Amsterdam (CEST, summer).
const wedNoon = new Date('2026-08-05T12:00:00.000Z');

test('online flag wins regardless of hours', () => {
  expect(availabilityState({ ...base, online: true }, wedNoon).kind).toBe('online');
});

test('open today → today_until with the closing time', () => {
  const p = { ...base, openingHours: { wed: { closed: false, allDay: false, from: '09:00', to: '23:00' } } };
  const a = availabilityState(p, wedNoon);
  expect(a.kind).toBe('today_until');
  expect(a.until).toBe('23:00');
});

test('already closed for the day → back_at next open day', () => {
  const p = {
    ...base,
    openingHours: {
      wed: { closed: false, allDay: false, from: '09:00', to: '13:00' }, // closes 13:00, now 14:00
      fri: { closed: false, allDay: false, from: '10:00', to: '20:00' },
    },
  };
  const a = availabilityState(p, wedNoon);
  expect(a.kind).toBe('back_at');
  expect(a.nextDay).toBe('fri');
});

test('opens later today still counts as today_until', () => {
  const p = { ...base, openingHours: { wed: { closed: false, allDay: false, from: '20:00', to: '23:59' } } };
  expect(availabilityState(p, wedNoon).until).toBe('23:59');
});

test('allDay → today_until', () => {
  const p = { ...base, openingHours: { wed: { closed: false, allDay: true, from: '', to: '' } } };
  expect(availabilityState(p, wedNoon).kind).toBe('today_until');
});

test('lastActiveToday reflects same-day activity only', () => {
  const same = availabilityState({ ...base, lastActiveAt: '2026-08-05T09:20:00.000Z' }, wedNoon);
  expect(same.lastActiveToday).toBe('11:20'); // 09:20 UTC → 11:20 CEST
  const other = availabilityState({ ...base, lastActiveAt: '2026-08-04T09:20:00.000Z' }, wedNoon);
  expect(other.lastActiveToday).toBeUndefined();
});

test('no hours at all → back_at with no nextDay', () => {
  const a = availabilityState(base, wedNoon);
  expect(a.kind).toBe('back_at');
  expect(a.nextDay).toBeUndefined();
});

// Listing sort/filter helpers (fix/search): rank online < open-today < back.
test('availabilityRank orders online < today < back', () => {
  const online = { ...base, online: true };
  const today = { ...base, openingHours: { wed: { closed: false, allDay: false, from: '09:00', to: '23:00' } } };
  expect(availabilityRank(online, wedNoon)).toBeLessThan(availabilityRank(today, wedNoon));
  expect(availabilityRank(today, wedNoon)).toBeLessThan(availabilityRank(base, wedNoon));
});

test('availableNow: online or open-today true, back-later false', () => {
  expect(availableNow({ ...base, online: true }, wedNoon)).toBe(true);
  expect(availableNow({ ...base, openingHours: { wed: { closed: false, allDay: true, from: '', to: '' } } }, wedNoon)).toBe(true);
  expect(availableNow(base, wedNoon)).toBe(false);
});
