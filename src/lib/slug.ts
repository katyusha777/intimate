/**
 * The ONE slug normalizer — profiles (data/db/account.ts) and orgs
 * (actions/admin/orgs.ts) both build public URL segments from names; a rule
 * change (transliteration, length cap) must hit both or URLs diverge.
 * Dedupe loops stay at the callers (different tables).
 */
export function slugifyBase(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  );
}
