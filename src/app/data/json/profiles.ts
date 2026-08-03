/**
 * JSON backend for profiles — the "database" until the swap (docs/API.md).
 * All list semantics live in applyProfileListParams (models/profile.ts),
 * shared verbatim with the db backend so the two can never drift. Public
 * visibility rule: only `live` rows leave the backend.
 */
import { z } from 'zod';
import { applyProfileListParams, ProfileSchema, type ProfilesApi } from '@/app/models/profile';
import raw from './profiles.json';

const ALL = z.array(ProfileSchema).parse(raw);
// Visibility rule enforced at the backend, exactly like the DB backend.
const LIVE = ALL.filter((p) => p.state === 'live');

export const profilesApi: ProfilesApi = {
  async list(params = {}) {
    return applyProfileListParams(LIVE, params);
  },

  async bySlug(slug) {
    return LIVE.find((p) => p.slug === slug) ?? null;
  },

  // Admin surface: this backend is the read-only parity reference, so the
  // reads work over the fixture and the write is a deliberate no-op.
  async listAll() {
    return ALL;
  },
  async byId(id) {
    return ALL.find((p) => p.id === id) ?? null;
  },
  async setState() {
    throw new Error('json backend is read-only — the db backend owns writes');
  },
};
