/**
 * Pre-launch corridor (lib/prelaunch.ts): the apex host serves the pre-launch
 * landing + /agencies + the just-joined professional's /account builder;
 * everything else redirects. Pure-function tests — the hostname branch can't be
 * exercised against localhost.
 */
import { describe, expect, test } from 'bun:test';
import { corridor } from '../src/lib/prelaunch';

const u = (path: string) => new URL(`https://intimate.nl${path}`);
const kind = (path: string, xSheet = false, authed = false) => corridor(u(path), xSheet, authed).kind;

describe('prelaunch corridor', () => {
  test('locale home rewrites to the prelaunch page', () => {
    expect(corridor(u('/nl/'), false)).toEqual({ kind: 'rewrite', to: '/nl/prelaunch/' });
    expect(corridor(u('/en'), false)).toEqual({ kind: 'rewrite', to: '/en/prelaunch/' });
  });

  test('the closer page and legal pages pass', () => {
    expect(kind('/nl/agencies/')).toBe('pass');
    expect(kind('/en/agencies')).toBe('pass');
    expect(kind('/nl/privacy/')).toBe('pass');
    expect(kind('/nl/terms/')).toBe('pass');
  });

  test('agency detail pages are sealed (preview links live on beta)', () => {
    expect(kind('/nl/agencies/elite-escorts/')).toBe('redirect');
  });

  test('profile pages pass for the ProfileSheet fetch (X-Sheet) or an authed view', () => {
    expect(kind('/nl/profile/alice/', true)).toBe('pass');
    expect(kind('/nl/profile/alice/avail.json', true)).toBe('pass');
    // Admin god-view / owner preview: a full-page nav with a session cookie.
    expect(kind('/nl/profile/alice/', false, true)).toBe('pass');
    // Anonymous full-page nav stays bounced.
    expect(kind('/nl/profile/alice/')).toBe('redirect');
    expect(kind('/nl/profile/alice/extra/', true)).toBe('redirect');
  });

  test('infrastructure prefixes pass', () => {
    for (const p of ['/admin/verification', '/auth/confirm', '/api/cache/urls', '/_actions/agencies.join', '/media/org/x/y', '/sitemap.xml', '/sitemap-listings-nl.xml']) {
      expect(kind(p)).toBe('pass');
    }
  });

  test('the pre-signup professional builds her profile under /account (passes)', () => {
    // Advertiser join creates a passwordless draft account; she builds in the
    // real onboarding + editor, rendered BARE on the apex.
    expect(kind('/nl/account/')).toBe('pass');
    expect(kind('/nl/account/setup/')).toBe('pass');
    expect(kind('/en/account/profile/')).toBe('pass');
    // The old bare upload page is gone — it dead-ends like any other path now.
    expect(kind('/nl/prelaunch/build/')).toBe('redirect');
    expect(kind('/nl/prelaunch/')).toBe('redirect');
  });

  test('the editorial shelf passes (indexable articles the landing links to)', () => {
    expect(kind('/nl/blog/')).toBe('pass');
    expect(kind('/nl/blog/welkom-bij-intimate/')).toBe('pass');
    expect(kind('/en/blog/gratis-wallpapers')).toBe('pass');
    // Not a slug segment past the reader — dead-ends.
    expect(kind('/nl/blog/welkom-bij-intimate/extra/')).toBe('redirect');
  });

  test('the rest of the site dead-ends', () => {
    for (const p of ['/nl/amsterdam/', '/nl/search/', '/kitchen-sink', '/nl/stats/', '/nl/messages/']) {
      expect(kind(p)).toBe('redirect');
    }
  });
});
