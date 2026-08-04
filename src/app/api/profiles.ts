/**
 * Profiles API — the data-source seam (docs/API.md).
 * Pages/layouts/actions call this module and never a backend directly.
 * LIVE on the Drizzle backend (hosted Postgres via Hyperdrive) — the json
 * backend remains only as the parity reference (tests/db-parity.test.ts).
 */
import { env } from 'cloudflare:workers';
import { profilesDbApi } from '@/app/data/db/profiles';

export const profilesApi = profilesDbApi(
  () => (env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE,
);
