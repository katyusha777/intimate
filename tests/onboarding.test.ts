/**
 * Derived onboarding progress (src/lib/onboarding.ts): the gate that decides
 * what she still has to do and whether she can submit. Getting this wrong either
 * blocks a complete profile or lets an empty one reach the review queue.
 */
import { expect, test } from 'bun:test';
import { onboardingProgress } from '@/lib/onboarding';
import type { Profile } from '@/app/models/profile';
import type { Account } from '@/app/models/account';

// Minimal structural stand-ins — the helper only reads these fields.
const profile = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'p1',
    state: 'draft',
    rates: [{ duration: '1_hour', incall: 150 }],
    services: ['erotic_massage'],
    photos: ['pub/p1/a'],
    openingHours: {},
    ...over,
  }) as unknown as Profile;

const account = (over: Partial<Account> = {}): Account =>
  ({ phoneVerifiedAt: '2026-08-04T00:00:00Z', idVerification: 'pending', ...over }) as unknown as Account;

test('a fully-filled draft is ready to submit', () => {
  const p = onboardingProgress(profile(), account());
  expect(p.requiredDone).toBe(p.requiredTotal);
  expect(p.firstIncomplete).toBeNull();
  expect(p.readyToSubmit).toBe(true);
  expect(p.submitted).toBe(false);
});

test('no profile row yet → basics is the first incomplete step', () => {
  const p = onboardingProgress(profile({ id: '' }), account());
  expect(p.steps.find((s) => s.key === 'basics')!.done).toBe(false);
  expect(p.firstIncomplete).toBe('basics');
  expect(p.readyToSubmit).toBe(false);
});

test('the required path is basics → photos → id (photos-first onboarding)', () => {
  // No photos → photos blocks submission.
  expect(onboardingProgress(profile({ photos: [] }), account()).firstIncomplete).toBe('photos');
  // Unverified / rejected id → id blocks.
  expect(onboardingProgress(profile(), account({ idVerification: 'unverified' })).firstIncomplete).toBe('id');
  expect(onboardingProgress(profile(), account({ idVerification: 'rejected' })).firstIncomplete).toBe('id');
});

test('contact/rates/services/hours/phone are optional — they never block submit', () => {
  // Everything soft empty, but the required three (basics, photos, id) are done.
  const p = onboardingProgress(
    profile({ rates: [{ duration: '1_hour' } as never], services: [], openingHours: {}, whatsapp: undefined, telegram: undefined, instagram: undefined, phone: undefined }),
    account({ phoneVerifiedAt: undefined }),
  );
  for (const k of ['contact', 'rates', 'services', 'hours', 'phone'] as const) {
    expect(p.steps.find((s) => s.key === k)!.optional).toBe(true);
  }
  expect(p.firstIncomplete).toBeNull();
  expect(p.readyToSubmit).toBe(true); // approvable without the "reading" or SMS
});

test('once submitted, readyToSubmit is false and submitted is true', () => {
  const p = onboardingProgress(profile({ state: 'pending_review' }), account());
  expect(p.submitted).toBe(true);
  expect(p.readyToSubmit).toBe(false);
});
