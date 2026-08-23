/**
 * Registration wall (lib/gate.ts): anonymous humans see only the welcome pitch
 * (+ a small allowlist); crawlers, the warm cron and signed-in users pass.
 * Pure-function tests, same shape as the deleted corridor's suite.
 */
import { describe, expect, test } from 'bun:test';
import { BOT_RE, focusRedirect, gate } from '../src/lib/gate';

const u = (path: string) => new URL(`https://intimate.nl${path}`);
const anon = { anonymous: true, bot: false, warm: false };
const kind = (path: string, v: Partial<typeof anon> = {}) => gate(u(path), { ...anon, ...v }).kind;

describe('registration wall', () => {
  test('locale home rewrites to the welcome page for anonymous humans', () => {
    expect(gate(u('/nl/'), anon)).toEqual({ kind: 'rewrite', to: '/nl/welcome/' });
    expect(gate(u('/en'), anon)).toEqual({ kind: 'rewrite', to: '/en/welcome/' });
  });

  test('signed-in users, crawlers and the warm cron pass everywhere', () => {
    for (const p of ['/nl/', '/nl/amsterdam/', '/nl/profile/alice/', '/nl/search/']) {
      expect(kind(p, { anonymous: false })).toBe('pass');
      expect(kind(p, { bot: true })).toBe('pass');
      expect(kind(p, { warm: true })).toBe('pass');
    }
  });

  test('crawler UA list covers the robots.txt allowlist + previews + perf tools', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'GPTBot/1.0 (+https://openai.com/gptbot)',
      'OAI-SearchBot/1.0',
      'ChatGPT-User/1.0',
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Claude-SearchBot/1.0',
      'PerplexityBot/1.0',
      'Mozilla/5.0 (compatible; YandexBot/3.0)',
      'DuckDuckBot/1.1',
      'facebookexternalhit/1.1',
      'WhatsApp/2.23.20',
      'TelegramBot (like TwitterBot)',
      'Twitterbot/1.0',
      'Mozilla/5.0 (compatible; Applebot/0.1)',
      'Chrome-Lighthouse',
      'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
      'Pinterest/0.2 (+https://www.pinterest.com/bot.html)',
      'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    ]) {
      expect(BOT_RE.test(ua), `${ua} must bypass the wall`).toBe(true);
    }
    // Real browsers and in-app WEBVIEWS must NOT match — the wall exists for
    // them (a stock browser accidentally matching = silent conversion leak).
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 DuckDuckGo/5',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 LinkedInApp',
    ]) {
      expect(BOT_RE.test(ua), `${ua} must hit the wall`).toBe(false);
    }
  });

  test('legal, support, agency pitch and the blog shelf stay open', () => {
    for (const p of ['/nl/privacy/', '/nl/terms/', '/en/support/', '/nl/agencies/', '/nl/blog/', '/nl/blog/welkom-bij-intimate/']) {
      expect(kind(p)).toBe('pass');
    }
    // Agency detail rosters are product — sealed.
    expect(kind('/nl/agencies/elite-escorts/')).toBe('redirect');
  });

  test('auth pages and invite links stay open (self-gating flows)', () => {
    expect(kind('/nl/auth/reset/')).toBe('pass');
    expect(kind('/en/auth/expired/')).toBe('pass');
    expect(kind('/nl/c/abc123/')).toBe('pass');
  });

  test('infrastructure prefixes pass', () => {
    for (const p of [
      '/admin/approvals',
      '/auth/confirm',
      '/api/cache/urls',
      '/_actions/auth.register',
      '/_server-islands/x',
      '/media/pub/x/y',
      '/sitemap.xml',
      '/sitemap-listings-nl.xml',
    ]) {
      expect(kind(p)).toBe('pass');
    }
  });

  test('profile pages pass for anonymous humans — direct links are her marketing', () => {
    expect(kind('/nl/profile/alice/')).toBe('pass');
    expect(kind('/nl/profile/alice/avail.json')).toBe('pass');
  });

  test('the welcome page itself passes; the product dead-ends to the gate', () => {
    expect(kind('/nl/welcome/')).toBe('pass');
    for (const p of ['/nl/amsterdam/', '/nl/search/', '/nl/stats/', '/nl/messages/', '/nl/account/', '/nl/app/']) {
      expect(kind(p)).toBe('redirect');
    }
  });
});

describe('advertiser focus-mode paths', () => {
  test('the setup flow and self-gating/reading paths render', () => {
    for (const p of ['/nl/account/setup/', '/nl/account/setup/?step=verify', '/nl/privacy/', '/nl/blog/x/', '/nl/auth/reset/', '/_actions/account.saveProfile', '/media/pub/x']) {
      expect(focusRedirect(u(p), 'nl')).toBeNull();
    }
  });

  test('everything else redirects into the flow', () => {
    for (const p of ['/nl/', '/nl/amsterdam/', '/nl/profile/alice/', '/nl/account/', '/nl/account/profile/', '/nl/messages/']) {
      expect(focusRedirect(u(p), 'nl')).toBe('/nl/account/setup/');
    }
  });
});
