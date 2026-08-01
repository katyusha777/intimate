/**
 * Session domain model (docs/API.md seam). The interface is the contract:
 * today a mock cookie backend, later Supabase Auth SSR cookies — call sites
 * never change.
 */
import { z } from 'zod';
import { ACCOUNT_TYPES } from '@/lib/taxonomy';

export const SessionSchema = z.object({
  email: z.string().email(),
  role: z.enum(ACCOUNT_TYPES),
  /** Display name (advertiser: profile name; client: derived from email). */
  name: z.string().min(1),
  /** Linked public profile — advertisers only. */
  profileId: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Minimal cookie jar contract — satisfied by Astro.cookies AND the actions context. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    opts?: {
      path?: string;
      maxAge?: number;
      httpOnly?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
    },
  ): void;
  delete(name: string, opts?: { path?: string }): void;
}

export interface SessionApi {
  /** Cookie is untrusted input: strict parse, anything invalid → null. */
  fromCookies(cookies: CookieJar): Promise<Session | null>;
  register(cookies: CookieJar, input: { email: string; role: 'advertiser' | 'client' }): Promise<Session>;
  signIn(cookies: CookieJar, input: { email: string }): Promise<Session>;
  signOut(cookies: CookieJar): Promise<void>;
}
