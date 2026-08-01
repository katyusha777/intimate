/**
 * Mock account backend: records live in the SESSION KV under mockacct:{email},
 * so profile edits, photos and verification state persist across reloads in
 * dev AND on staging. The Supabase backend replaces this file (accounts +
 * verification tables, RLS); the seam (api/account.ts) is the switch.
 */
import { env } from 'cloudflare:workers';
import { AccountSchema, type Account, type AccountApi } from '@/app/models/account';
import type { Session } from '@/app/models/session';
import { profilesApi } from '@/app/data/json/profiles';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}

const key = (session: Session) => `mockacct:${session.email.toLowerCase()}`;

export const accountApi: AccountApi = {
  async get(session) {
    const raw = await kv()?.get(key(session));
    if (!raw) return AccountSchema.parse({});
    try {
      const parsed = AccountSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : AccountSchema.parse({});
    } catch {
      return AccountSchema.parse({});
    }
  },

  async save(session, patch) {
    const current = await this.get(session);
    const next = AccountSchema.parse({
      ...current,
      ...patch,
      profileOverride: { ...current.profileOverride, ...(patch.profileOverride ?? {}) },
    });
    await kv()?.put(key(session), JSON.stringify(next));
    return next;
  },

  async myProfile(session) {
    if (!session.profileId) return null;
    const { items } = await profilesApi.list({ limit: 60 });
    const base = items.find((p) => p.id === session.profileId);
    if (!base) return null;
    const acct = await this.get(session);
    const removed = new Set(acct.removedPhotos);
    return {
      ...base,
      ...acct.profileOverride,
      photos: [...base.photos.filter((_, i) => !removed.has(i)), ...acct.extraPhotos],
    };
  },
};
