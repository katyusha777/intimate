/**
 * Password policy (#3): a minimum length + character classes, shared by the
 * server actions (register / reset / change — real enforcement) and the client
 * strength meter (live checklist). Pure + tiny so both sides agree exactly.
 */
export const PW_MIN = 8;

export type PwRuleId = 'len' | 'upper' | 'lower' | 'number' | 'special';

/** One entry per requirement, with whether the given password satisfies it. */
export function passwordChecks(pw: string): { id: PwRuleId; ok: boolean }[] {
  return [
    { id: 'len', ok: pw.length >= PW_MIN },
    { id: 'upper', ok: /[A-Z]/.test(pw) },
    { id: 'lower', ok: /[a-z]/.test(pw) },
    { id: 'number', ok: /[0-9]/.test(pw) },
    { id: 'special', ok: /[^A-Za-z0-9]/.test(pw) },
  ];
}

/** True only when every requirement is met — the server gate. */
export function passwordOk(pw: string): boolean {
  return passwordChecks(pw).every((c) => c.ok);
}
