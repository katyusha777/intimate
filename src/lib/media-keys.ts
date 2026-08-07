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
