import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Server-side data path: Drizzle → Hyperdrive → Postgres.
 * Pass the HYPERDRIVE binding (cloudflare:workers env) — or any object with a
 * connectionString (tests use the local Supabase Postgres directly).
 */
export function createDb(hyperdrive: Pick<Hyperdrive, 'connectionString'>) {
  const client = postgres(hyperdrive.connectionString, {
    // Workers guidance: small pool, no type fetching round-trip.
    max: 5,
    fetch_types: false,
    prepare: false,
    // Don't echo server NOTICE/WARNING to the console (e.g. realtime.send's
    // "no partition" notice before Realtime first runs) — they're not errors.
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// ── Request-scoped client ───────────────────────────────────────────────────
// One postgres client (connection pool) per REQUEST, shared by every seam and
// action in that request. Before this, every seam call built a fresh client, so
// a single page paid connection setup 4-5×. workerd forbids reuse ACROSS
// requests (hence no module-scope client); AsyncLocalStorage scopes it to one.
const dbStore = new AsyncLocalStorage<{ db?: Db; memo?: Map<string, unknown> }>();

/** Middleware wraps each request so requestDb() memoizes inside it. */
export function withRequestDb<T>(fn: () => T): T {
  return dbStore.run({}, fn);
}

/** Per-request memo bucket for seams that re-read the same data in one render
 *  (e.g. the live-profile catalog — the home page alone lists it three times).
 *  Undefined outside a request (tests, scripts, cron) — no caching there. */
export function requestMemo(): Map<string, unknown> | undefined {
  const store = dbStore.getStore();
  if (!store) return undefined;
  return (store.memo ??= new Map());
}

/** The request's shared client — falls back to a fresh one outside a request
 *  (tests, scripts, cron), where reuse rules don't apply. */
export function requestDb(hyperdrive: Pick<Hyperdrive, 'connectionString'>): Db {
  const store = dbStore.getStore();
  if (!store) return createDb(hyperdrive);
  return (store.db ??= createDb(hyperdrive));
}
