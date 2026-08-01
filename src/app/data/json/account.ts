/**
 * Mock account backend: records live in the SESSION KV under mockacct:{email},
 * so profile edits, photos and verification state persist across reloads in
 * dev AND on staging. An email index (mockacct:index) lets admin enumerate
 * accounts — the mock stand-in for a Postgres table scan. The Supabase backend
 * replaces this file (accounts + verification tables, RLS); the seam
 * (api/account.ts) is the switch.
 */
import { env } from 'cloudflare:workers';
import { AccountSchema, type Account, type AccountApi, type AccountRecord } from '@/app/models/account';
import { ratesMinPrice } from '@/app/models/profile';
import type { Session } from '@/app/models/session';
import { profilesApi } from '@/app/data/json/profiles';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}

const acctKey = (email: string) => `mockacct:${email.toLowerCase()}`;
const INDEX_KEY = 'mockacct:index';

async function readIndex(): Promise<string[]> {
  const raw = await kv()?.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function readAccount(email: string): Promise<Account> {
  const raw = await kv()?.get(acctKey(email));
  if (!raw) return AccountSchema.parse({});
  try {
    const parsed = AccountSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : AccountSchema.parse({});
  } catch {
    return AccountSchema.parse({});
  }
}

async function writeAccount(email: string, current: Account, patch: Partial<Account>): Promise<Account> {
  const next = AccountSchema.parse({
    ...current,
    ...patch,
    profileOverride: { ...current.profileOverride, ...(patch.profileOverride ?? {}) },
  });
  await kv()?.put(acctKey(email), JSON.stringify(next));
  const index = await readIndex();
  if (!index.includes(email.toLowerCase())) {
    await kv()?.put(INDEX_KEY, JSON.stringify([...index, email.toLowerCase()]));
  }
  return next;
}

export const accountApi: AccountApi = {
  async get(session) {
    return readAccount(session.email);
  },

  async save(session, patch) {
    const current = await readAccount(session.email);
    return writeAccount(session.email, current, patch);
  },

  async myProfile(session) {
    if (!session.profileId) return null;
    const { items } = await profilesApi.list({ limit: 60 });
    const base = items.find((p) => p.id === session.profileId);
    if (!base) return null;
    const acct = await readAccount(session.email);
    const removed = new Set(acct.removedPhotos);
    const merged = { ...base, ...acct.profileOverride };
    return {
      ...merged,
      // priceFrom is derived (UX-PLAN 2.1) — recompute after the override may
      // have changed the rates table, else the base's stale number would show.
      priceFrom: ratesMinPrice(merged.rates) ?? merged.priceFrom,
      photos: [...base.photos.filter((_, i) => !removed.has(i)), ...acct.extraPhotos],
    };
  },

  async all() {
    const emails = await readIndex();
    const out: AccountRecord[] = [];
    for (const email of emails) out.push({ email, ...(await readAccount(email)) });
    return out;
  },

  async byEmail(email) {
    const emails = await readIndex();
    if (!emails.includes(email.toLowerCase())) return null;
    return { email: email.toLowerCase(), ...(await readAccount(email)) };
  },

  async saveByEmail(email, patch) {
    const current = await readAccount(email);
    return writeAccount(email, current, patch);
  },
};
