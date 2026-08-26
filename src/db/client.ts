import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Server-side data path: Drizzle → Hyperdrive → Postgres.
 * Pass the HYPERDRIVE binding (cloudflare:workers env) — or any object with a
 * connectionString (tests use the local Supabase Postgres directly).
 */
/**
 * Retry SELECTs once on any failure. Prod sees a few transient server-side
 * ErrorResponses per day (Hyperdrive/pooler blips) that 500 random public
 * pages; selects are idempotent, so one immediate re-run is always safe.
 * Wraps `unsafe` because it is the one choke point every drizzle query goes
 * through (session.js awaits `client.unsafe(...)` or `.values()` on it —
 * the wrapper only needs those two shapes). Writes are never retried.
 */
// ponytail: retries on ANY select error (not just transient codes) — narrow to
// connection/57xxx codes if duplicate round-trips on broken queries ever matter.
export function wrapSelectRetry(raw: (query: string, params?: unknown[]) => { values(): Promise<unknown> } & PromiseLike<unknown>) {
  return (query: string, params?: unknown[]) => {
    if (!/^\s*select\b/i.test(query)) return raw(query, params);
    const attempt = (values: boolean) => {
      const q = raw(query, params);
      return Promise.resolve(values ? q.values() : q);
    };
    const withRetry = (values: boolean) => attempt(values).catch(() => attempt(values));
    return {
      then: (onOk?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => withRetry(false).then(onOk, onErr),
      values: () => withRetry(true),
    };
  };
}

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
  client.unsafe = wrapSelectRetry(client.unsafe.bind(client) as never) as unknown as typeof client.unsafe;
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
