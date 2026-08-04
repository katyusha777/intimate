/**
 * Professional onboarding progress — DERIVED from her profile + account, never
 * stored (docs/ONBOARDING.md §4). One source of truth for: the setup flow's
 * resume point, the dashboard checklist card, the status banner, and the
 * /account/ redirect. Pure + unit-tested; no i18n or links here (the component
 * owns presentation).
 *
 * Solo professional only — callers gate on `role === 'advertiser'` (agencies and
 * clients never see this).
 */
import type { Profile } from '@/app/models/profile';
import type { Account } from '@/app/models/account';
import type { ProfileState } from '@/lib/taxonomy';

export type OnboardingStepKey = 'basics' | 'rates' | 'services' | 'photos' | 'hours' | 'phone' | 'id';

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  /** Optional steps never block submitting and are skipped when finding resume/next. */
  optional: boolean;
}

export interface OnboardingProgress {
  /** In flow order; `hours` is the one optional step. */
  steps: OnboardingStep[];
  requiredTotal: number;
  requiredDone: number;
  /** First REQUIRED step not yet done — where the flow resumes. Null when all done. */
  firstIncomplete: OnboardingStepKey | null;
  /** Every required step done AND not yet submitted → show the Submit CTA. */
  readyToSubmit: boolean;
  /** She has submitted (profile left `draft`): pending_review / live / paused / … */
  submitted: boolean;
  state: ProfileState;
}

// The flow order (docs/ONBOARDING.md §2). `hours` is optional.
const ORDER: OnboardingStepKey[] = ['basics', 'rates', 'services', 'photos', 'hours', 'phone', 'id'];
const OPTIONAL = new Set<OnboardingStepKey>(['hours']);

/** A rate row counts once it carries at least one price (incall or outcall). */
const hasPricedRate = (p: Profile) => p.rates.some((r) => r.incall != null || r.outcall != null);

export function onboardingProgress(profile: Profile, account: Account): OnboardingProgress {
  const done: Record<OnboardingStepKey, boolean> = {
    // A profile row only exists once the mandatory identity fields were saved,
    // so its presence IS "basics done" (data/db/account.ts saveProfile).
    basics: profile.id !== '',
    rates: hasPricedRate(profile),
    services: profile.services.length >= 1,
    photos: profile.photos.length >= 1,
    hours: Object.keys(profile.openingHours).length > 0,
    phone: Boolean(account.phoneVerifiedAt),
    id: account.idVerification === 'pending' || account.idVerification === 'approved',
  };

  const steps = ORDER.map((key) => ({ key, done: done[key], optional: OPTIONAL.has(key) }));
  const required = steps.filter((s) => !s.optional);
  const firstIncomplete = required.find((s) => !s.done)?.key ?? null;
  const submitted = profile.state !== 'draft';

  return {
    steps,
    requiredTotal: required.length,
    requiredDone: required.filter((s) => s.done).length,
    firstIncomplete,
    readyToSubmit: firstIncomplete === null && !submitted,
    submitted,
    state: profile.state,
  };
}
