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

test('a rate row without a price does not count', () => {
  const p = onboardingProgress(profile({ rates: [{ duration: '1_hour' } as never] }), account());
  expect(p.steps.find((s) => s.key === 'rates')!.done).toBe(false);
  expect(p.firstIncomplete).toBe('rates');
});

test('unverified id / missing phone block submission', () => {
  const noPhone = onboardingProgress(profile(), account({ phoneVerifiedAt: undefined }));
  expect(noPhone.firstIncomplete).toBe('phone');
  const noId = onboardingProgress(profile(), account({ idVerification: 'unverified' }));
  expect(noId.firstIncomplete).toBe('id');
  // 'rejected' also does not count as done.
  expect(onboardingProgress(profile(), account({ idVerification: 'rejected' })).firstIncomplete).toBe('id');
});

test('hours is optional — it never blocks submit or resume', () => {
  const p = onboardingProgress(profile({ openingHours: {} }), account());
  expect(p.steps.find((s) => s.key === 'hours')!.optional).toBe(true);
  expect(p.readyToSubmit).toBe(true); // hours empty, still submittable
});

test('once submitted, readyToSubmit is false and submitted is true', () => {
  const p = onboardingProgress(profile({ state: 'pending_review' }), account());
  expect(p.submitted).toBe(true);
  expect(p.readyToSubmit).toBe(false);
});
