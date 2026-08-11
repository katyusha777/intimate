/**
 * Pre-signup uploads (pre-launch corridor): a professional who left her contacts
 * on the landing drops photos + ID here BEFORE she has an account. Bytes live in
 * R2 keyed by her lead id (the `psl` cookie capability) — there's NO DB table,
 * R2 list-by-prefix IS the index. Retires at launch with the rest of the
 * corridor; at launch an admin moves these onto her real profile / verification.
 *
 * Photos → MEDIA bucket under `presignup/<leadId>/<uuid>.jpg`, served back to
 * HER only through the cookie-gated /api/prelaunch/media route (never edge-
 * cached, never public — the /media route's `pub/` gate needs a media row these
 * don't have, which is exactly why they get their own prefix + route).
 * ID docs → the private EU VERIFICATION bucket (hard rule 3), NEVER served back.
 */
import { env } from 'cloudflare:workers';

/** Cap the pre-signup gallery — she refines the real set in onboarding later. */
const MAX_PHOTOS = 12;

const mediaBucket = () => (env as unknown as { MEDIA: R2Bucket }).MEDIA;
const verificationBucket = () => (env as unknown as { VERIFICATION: R2Bucket }).VERIFICATION;

const photoPrefix = (leadId: string) => `presignup/${leadId}/`;

/** Store an already-stripped JPEG as one of her pre-signup photos. Returns the
 *  R2 key (the /api/prelaunch/media route serves it back, cookie-gated). */
export async function addPresignupPhoto(
  leadId: string,
  bytes: ArrayBuffer,
): Promise<{ key: string } | { error: 'full' }> {
  const existing = await mediaBucket().list({ prefix: photoPrefix(leadId) });
  if (existing.objects.length >= MAX_PHOTOS) return { error: 'full' };
  const key = `${photoPrefix(leadId)}${crypto.randomUUID()}.jpg`;
  await mediaBucket().put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return { key };
}

/** Her pre-signup photo keys (uuid order — arbitrary, order doesn't matter here). */
export async function listPresignupPhotos(leadId: string): Promise<string[]> {
  const { objects } = await mediaBucket().list({ prefix: photoPrefix(leadId) });
  return objects.map((o) => o.key).sort();
}

/** Remove ONE of her photos — the key MUST sit under her own folder (capability
 *  check), so a crafted key can't touch another lead's gallery. */
export async function removePresignupPhoto(leadId: string, key: string): Promise<void> {
  if (!key.startsWith(photoPrefix(leadId))) return; // not hers → no-op
  await mediaBucket().delete(key);
}

/** Read one photo's bytes for the cookie-gated serve route. `name` is a single
 *  path segment from the route — pin it into HER folder so a `/`-crafted name
 *  can't escape the prefix. */
export async function getPresignupPhoto(leadId: string, name: string): Promise<ArrayBuffer | null> {
  if (!name || name.includes('/')) return null;
  const obj = await mediaBucket().get(`${photoPrefix(leadId)}${name}`);
  return obj ? obj.arrayBuffer() : null;
}

/** Store her ID doc in the private EU verification bucket (hard rule 3 — toxic
 *  waste). Never served back; an admin retrieves it at launch when she claims
 *  her account. Already EXIF-stripped by the action boundary. */
export async function addPresignupId(leadId: string, bytes: ArrayBuffer): Promise<void> {
  await verificationBucket().put(`presignup/${leadId}/${crypto.randomUUID()}.jpg`, bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
}

/** Has she uploaded an ID yet? Drives the build-page ✓ state. */
export async function hasPresignupId(leadId: string): Promise<boolean> {
  const { objects } = await verificationBucket().list({ prefix: `presignup/${leadId}/` });
  return objects.length > 0;
}
