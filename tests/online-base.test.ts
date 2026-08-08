/**
 * phantomOnlineBase — the cosmetic "online now" floor. If this drifts out of
 * range the fold either reads dead (< 72) or absurd.
 */
import { expect, test } from 'bun:test';
import { phantomOnlineBase } from '@/lib/online-base';

test('stays in the 72..96 band across a year of minutes', () => {
  for (let t = 0; t < 366 * 24 * 60; t += 7) {
    const n = phantomOnlineBase(t * 60_000);
    expect(n).toBeGreaterThanOrEqual(72);
    expect(n).toBeLessThanOrEqual(96);
  }
});

test('constant within a ~6-min bucket, drifts across buckets', () => {
  const a = phantomOnlineBase(0);
  expect(phantomOnlineBase(5 * 60_000)).toBe(a); // same bucket
  // Some later bucket differs — the number is not frozen.
  const moved = Array.from({ length: 50 }, (_, i) => phantomOnlineBase((i + 1) * 6 * 60_000));
  expect(moved.some((v) => v !== a)).toBe(true);
});
