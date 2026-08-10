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

export type OnboardingStepKey = 'basics' | 'contact' | 'photos' | 'id' | 'rates' | 'services' | 'hours' | 'phone';

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  /** Optional steps never block submitting and are skipped when finding resume/next. */
  optional: boolean;
}

export interface OnboardingProgress {
  /** In flow order; rates/services/hours/phone are optional (filled later). */
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

// The flow order (docs/ONBOARDING.md §2). Photos-first onboarding (2026-08-10):
// the REQUIRED path is identity → contact → photos → ID, so she gets a photo'd,
// verified, approvable profile fast. The "reading" (rates, services, hours) and
// the optional SMS-verify are demoted to optional — filled later from the
// dashboard; a profile can be approved without them.
const ORDER: OnboardingStepKey[] = ['basics', 'contact', 'photos', 'id', 'rates', 'services', 'hours', 'phone'];
// Required to submit: identity (basics), photos, ID. Everything else — contact
// channels, rates, services, hours, SMS — is optional (encouraged in the flow,
// filled later; a profile is approvable without them).
const OPTIONAL = new Set<OnboardingStepKey>(['contact', 'rates', 'services', 'hours', 'phone']);

/** A rate row counts once it carries at least one price (incall or outcall). */
const hasPricedRate = (p: Profile) => p.rates.some((r) => r.incall != null || r.outcall != null);

/** At least one way for a client to reach her off-platform. */
const hasContact = (p: Profile) => Boolean(p.whatsapp || p.telegram || p.instagram || p.phone);

export function onboardingProgress(profile: Profile, account: Account): OnboardingProgress {
  const done: Record<OnboardingStepKey, boolean> = {
    // A profile row only exists once the mandatory identity fields were saved,
    // so its presence IS "basics done" (data/db/account.ts saveProfile).
    basics: profile.id !== '',
    contact: hasContact(profile),
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
