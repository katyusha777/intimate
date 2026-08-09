/**
 * R2 media-key helpers (shared so the takedown predicate can't drift between
 * copies — a wrong `isR2Key` would leak photo bytes past a takedown, or delete
 * a seed/static path). Server-only (needs the MEDIA binding).
 *
 * Also the single home for the /media edge-cache vocabulary: the variant map,
 * the canonical cache URL (put/match/delete must agree byte-for-byte), and
 * best-effort eviction. The route derives everything from here.
 */
import { env, waitUntil } from 'cloudflare:workers';

/** The photo R2 bucket (public + private prefixes live here). */
export const mediaBucket = (): R2Bucket => (env as unknown as { MEDIA: R2Bucket }).MEDIA;

/** A stored key we manage in R2 (`pub/…` / `priv/…`) vs a seed/static path
 *  (`/img/…`, `https://…`) that must never be handed to `bucket.delete`. */
export const isR2Key = (key: string): boolean => !key.startsWith('/') && !key.startsWith('http');

/** ?v= variants the /media route serves — ONE vocabulary for the route's
 *  transform widths AND the evict enumeration (drift = un-evictable copies). */
export const VARIANT_WIDTH: Record<string, number> = { thumb: 200, card: 600, full: 1200 };

/** The workerd edge cache, absent off-workerd (bun tests, some dev modes). */
export const edgeCache = (): Cache | undefined =>
  (globalThis.caches as unknown as { default?: Cache } | undefined)?.default;

/**
 * Canonical edge-cache key for a photo: fixed origin + path + validated ?v
 * ONLY. Never the raw request URL — stray query params would mint unbounded
 * cache entries (each a billed transform) that eviction could never name.
 */
export function mediaCacheUrl(key: string, variant?: string): string {
  const origin =
    (env as unknown as { PUBLIC_SITE_ORIGIN?: string }).PUBLIC_SITE_ORIGIN ?? 'https://intimate.nl';
  // hasOwn, not truthiness: ?v= is attacker-controlled and a plain object
  // lookup leaks Object.prototype keys ('constructor' → a Function).
  const v = variant && Object.hasOwn(VARIANT_WIDTH, variant) ? `?v=${variant}` : '';
  return `${origin}/media/${key}${v}`;
}

/**
 * Best-effort edge-cache eviction for taken-down photo keys. The media-row
 * gate in the /media route is the GUARANTEE (a missing/rejected row blocks
 * serving before the cache lookup, globally, within DB-read freshness); this
 * makes the common case instant — Cache API deletes are colo-local, and Smart
 * Placement concentrates the worker's cache in one colo. Fire-and-forget on
 * waitUntil (push.ts pattern): eviction must never add latency to, or fail,
 * the takedown that caused it. No-op outside workerd (tests) or non-R2 keys.
 */
export function evictMediaCache(keys: string[]): void {
  const edge = edgeCache();
  if (!edge) return;
  const variants = ['', ...Object.keys(VARIANT_WIDTH)];
  waitUntil(
    Promise.allSettled(
      keys.filter(isR2Key).flatMap((k) => variants.map((v) => edge.delete(mediaCacheUrl(k, v)))),
    ),
  );
}
