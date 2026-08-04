/**
 * Verification-doc signed URLs (src/lib/vdoc-sign.ts) — the toxic-waste access
 * gate (hard rule 3). A valid signature must round-trip; an expired or tampered
 * one must be rejected. Getting this wrong either locks admins out or leaks IDs.
 */
import { expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({ env: { VDOC_SIGNING_SECRET: 'test-secret-123' } }));

const { signVdocUrl, verifyVdoc } = await import('../src/lib/vdoc-sign');

const parse = (url: string) => {
  const u = new URL(`https://x${url}`);
  return { id: u.pathname.split('/').pop()!, exp: u.searchParams.get('exp')!, sig: u.searchParams.get('sig')! };
};

test('a fresh signature verifies', async () => {
  const now = 1_000_000;
  const { id, exp, sig } = parse(await signVdocUrl('doc-abc', now));
  expect(id).toBe('doc-abc');
  expect(await verifyVdoc('doc-abc', exp, sig, now + 60_000)).toBe(true); // 1 min later, still valid
});

test('an expired signature is rejected', async () => {
  const now = 1_000_000;
  const { exp, sig } = parse(await signVdocUrl('doc-abc', now));
  expect(await verifyVdoc('doc-abc', exp, sig, now + 6 * 60_000)).toBe(false); // 6 min > 5 min TTL
});

test('a tampered signature or doc id is rejected', async () => {
  const now = 1_000_000;
  const { exp, sig } = parse(await signVdocUrl('doc-abc', now));
  expect(await verifyVdoc('doc-abc', exp, sig.slice(0, -2) + 'ff', now)).toBe(false); // flipped sig
  expect(await verifyVdoc('doc-OTHER', exp, sig, now)).toBe(false); // sig was for a different id
  expect(await verifyVdoc('doc-abc', 'notanumber', sig, now)).toBe(false); // junk exp
});
