/**
 * R2 media-key helpers (shared so the takedown predicate can't drift between
 * copies — a wrong `isR2Key` would leak photo bytes past a takedown, or delete
 * a seed/static path). Server-only (needs the MEDIA binding).
 */
import { env } from 'cloudflare:workers';

/** The photo R2 bucket (public + private prefixes live here). */
export const mediaBucket = (): R2Bucket => (env as unknown as { MEDIA: R2Bucket }).MEDIA;

/** A stored key we manage in R2 (`pub/…` / `priv/…`) vs a seed/static path
 *  (`/img/…`, `https://…`) that must never be handed to `bucket.delete`. */
export const isR2Key = (key: string): boolean => !key.startsWith('/') && !key.startsWith('http');

/** Every URL shape the /media route may have edge-cached for a key. */
const MEDIA_VARIANTS = ['', '?v=thumb', '?v=card', '?v=full'];

/**
 * Best-effort edge-cache eviction for taken-down photo keys — R2 byte deletion
 * alone no longer stops serving (the /media route caches transformed bytes in
 * caches.default). Cache API deletes are colo-local, but Smart Placement
 * concentrates the worker (and so its cache) in one colo, so this usually
 * evicts instantly; the s-maxage bound on the cached copy caps the miss case
 * at an hour. No-op outside workerd (tests) or for non-R2 keys.
 */
export async function evictMediaCache(keys: string[]): Promise<void> {
  const edge = (globalThis.caches as unknown as { default?: Cache } | undefined)?.default;
  const origin = (env as unknown as { PUBLIC_SITE_ORIGIN?: string }).PUBLIC_SITE_ORIGIN;
  if (!edge || !origin) return;
  await Promise.allSettled(
    keys
      .filter(isR2Key)
      .flatMap((k) => MEDIA_VARIANTS.map((v) => edge.delete(`${origin}/media/${k}${v}`))),
  );
}
