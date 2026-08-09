/**
 * Password policy: minimum length ONLY (8 chars). Deliberately simple — the
 * character-class requirements were blocking non-technical advertisers from
 * registering (feedback 2026-08-09). Shared by the server actions
 * (register / reset / change) and the client checklist so both agree exactly.
 */
export const PW_MIN = 8;

export type PwRuleId = 'len';

/** One entry per requirement, with whether the given password satisfies it. */
export function passwordChecks(pw: string): { id: PwRuleId; ok: boolean }[] {
  return [{ id: 'len', ok: pw.length >= PW_MIN }];
}

/** True only when every requirement is met — the server gate. */
export function passwordOk(pw: string): boolean {
  return pw.length >= PW_MIN;
}
