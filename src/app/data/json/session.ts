/**
 * Mock session backend: a JSON cookie + a lightweight user record in the
 * SESSION KV (so a registered role/profile is remembered on next sign-in —
 * register and login stay consistent for the same email). Dummy advertiser
 * identities link a real profile from the dataset so every screen has data.
 * ponytail: cookie is unsigned (demo). The Supabase backend replaces this file
 * with @supabase/ssr cookie sessions; the seam (api/session.ts) is the switch.
 */
import { env } from 'cloudflare:workers';
import { SessionSchema, type Session, type SessionApi, type CookieJar } from '@/app/models/session';
import { profilesApi } from '@/app/data/json/profiles';

const COOKIE = 'mock_session';
const MAX_AGE = 60 * 60 * 24 * 30;

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}
const userKey = (email: string) => `mockuser:${email.toLowerCase()}`;

async function write(cookies: CookieJar, session: Session): Promise<Session> {
  cookies.set(COOKIE, JSON.stringify(session), {
    path: '/',
    maxAge: MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
  });
  // Remember the identity so a later sign-in resolves the same role/profile.
  await kv()?.put(userKey(session.email), JSON.stringify(session));
  return session;
}

function localPart(email: string): string {
  return (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function advertiserIdentity(email: string): Promise<Session> {
  const { items } = await profilesApi.list({ limit: 60 });
  const lp = localPart(email);
  const match = items.find((p) => p.slug.startsWith(lp)) ?? items[0]!;
  return { email, role: 'advertiser', name: match.name, profileId: match.id, profileSlug: match.slug };
}

function clientIdentity(email: string): Session {
  const lp = localPart(email) || 'client';
  const name = lp.charAt(0).toUpperCase() + lp.slice(1);
  return { email, role: 'client', name };
}

export const sessionApi: SessionApi = {
  async fromCookies(cookies) {
    const raw = cookies.get(COOKIE)?.value;
    if (!raw) return null;
    try {
      const parsed = SessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },

  async register(cookies, { email, role }) {
    const session =
      role === 'advertiser' ? await advertiserIdentity(email) : clientIdentity(email);
    return write(cookies, session);
  },

  async signIn(cookies, { email }) {
    // Remembered from a prior register → same identity. Else the mock heuristic:
    // email local-part matching a profile slug → that advertiser, else client.
    const remembered = await kv()?.get(userKey(email));
    if (remembered) {
      const parsed = SessionSchema.safeParse(JSON.parse(remembered));
      if (parsed.success) return write(cookies, parsed.data);
    }
    const { items } = await profilesApi.list({ limit: 60 });
    const lp = localPart(email);
    const match = items.find((p) => p.slug.startsWith(lp));
    const session = match
      ? { email, role: 'advertiser' as const, name: match.name, profileId: match.id, profileSlug: match.slug }
      : clientIdentity(email);
    return write(cookies, session);
  },

  async signOut(cookies) {
    cookies.delete(COOKIE, { path: '/' });
  },
};
