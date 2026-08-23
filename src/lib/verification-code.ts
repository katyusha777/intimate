/**
 * The handwritten verification code (ARCHITECTURE §11): 4 letters the
 * professional writes on paper and photographs herself holding — a liveness
 * mark proving the photos were taken for US, not lifted from elsewhere.
 * Deterministically derived from the account email (the pre-af7a6774 mechanic,
 * letters-only this time): nothing to store, and every surface — the setup
 * screen and the admin review — derives the same code from the same email. It
 * is a liveness watermark, not a secret; predictability is fine because the
 * photo itself is what's being judged.
 */

/** No look-alikes (I/O/Q dropped) — she copies these by hand onto paper. */
const ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export function verificationCode(email: string): string {
  let h = 7;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0;
  let out = '';
  let x = Math.abs(h);
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[x % ALPHABET.length];
    x = Math.floor(x / ALPHABET.length) + i * 97; // stir so short hashes don't repeat letters
  }
  return out;
}
