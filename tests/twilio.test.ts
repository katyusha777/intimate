/**
 * Twilio Verify wiring (src/lib/twilio.ts): the request is shaped right (Verify
 * v2 URL, API-key Basic auth, form body) and only status==='approved' verifies.
 * No network — fetch + the worker env module are mocked.
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({
  env: {
    TWILIO_API_KEY_SID: 'SKtest',
    TWILIO_API_KEY_SECRET: 'secret',
    TWILIO_VERIFY_SERVICE_SID: 'VAtest',
  },
}));

const { startPhoneVerify, checkPhoneVerify } = await import('../src/lib/twilio');

let last: { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = ((url: string, init: RequestInit) => {
    last = { url, init };
    const body = String(init.body);
    // VerificationCheck echoes the code back as status for the assertion below.
    const status = url.endsWith('/VerificationCheck') ? (body.includes('Code=000000') ? 'approved' : 'pending') : 'pending';
    return Promise.resolve(new Response(JSON.stringify({ status }), { status: 200 }));
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('startPhoneVerify posts an SMS verification with API-key Basic auth', async () => {
  await startPhoneVerify('+31612345678');
  expect(last.url).toBe('https://verify.twilio.com/v2/Services/VAtest/Verifications');
  expect((last.init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('SKtest:secret')}`);
  expect(String(last.init.body)).toContain('Channel=sms');
  expect(String(last.init.body)).toContain(encodeURIComponent('+31612345678'));
});

test('checkPhoneVerify is true only when Twilio approves', async () => {
  expect(await checkPhoneVerify('+31612345678', '000000')).toBe(true);
  expect(await checkPhoneVerify('+31612345678', '999999')).toBe(false);
});

test('non-2xx throws', async () => {
  globalThis.fetch = (() => Promise.resolve(new Response('nope', { status: 401 }))) as unknown as typeof fetch;
  expect(startPhoneVerify('+31612345678')).rejects.toThrow('twilio Verifications 401');
});
