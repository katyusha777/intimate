/**
 * replySpeed (UX-PLAN 3.2) — the review-free trust signal. The two things that
 * must never drift: the ≥5 honest-sample threshold (below it we show nothing,
 * never a fabricated stat) and the median itself. Pure fixtures, fixed `now`.
 */
import { expect, test } from 'bun:test';
import { replySpeed, REPLY_SPEED_SAMPLE_MIN } from '@/app/models/messaging';

const NOW = new Date('2026-08-01T12:00:00.000Z');

/** A thread whose first client→professional reply took `mins`, `daysAgo` back. */
function thread(mins: number, daysAgo = 1) {
  const clientAt = new Date(NOW.getTime() - daysAgo * 86_400_000);
  const replyAt = new Date(clientAt.getTime() + mins * 60_000);
  return {
    messages: [
      { id: 'c', sender: 'client' as const, kind: 'text' as const, body: 'hi', createdAt: clientAt.toISOString() },
      { id: 'p', sender: 'professional' as const, kind: 'text' as const, body: 'hey', createdAt: replyAt.toISOString() },
    ],
  };
}

test('below the sample threshold → null (never fabricate)', () => {
  const few = Array.from({ length: REPLY_SPEED_SAMPLE_MIN - 1 }, () => thread(10));
  expect(replySpeed(few, NOW)).toBeNull();
});

test('at the threshold → median of an odd sample', () => {
  const rs = replySpeed([thread(4), thread(8), thread(11), thread(6), thread(15)], NOW);
  expect(rs).toEqual({ medianMinutes: 8, sampleSize: 5 }); // sorted 4,6,8,11,15 → 8
});

test('median of an even sample averages the two middles', () => {
  const rs = replySpeed([thread(4), thread(6), thread(8), thread(10), thread(12), thread(20)], NOW);
  // sorted 4,6,8,10,12,20 → (8+10)/2 = 9
  expect(rs).toEqual({ medianMinutes: 9, sampleSize: 6 });
});

test('replies outside the 30d window are dropped from the sample', () => {
  const inWindow = Array.from({ length: 4 }, () => thread(10, 5));
  const stale = Array.from({ length: 4 }, () => thread(10, 40)); // > 30d ago
  // 4 in-window is below threshold even though 8 replies exist in total.
  expect(replySpeed([...inWindow, ...stale], NOW)).toBeNull();
});

test('a thread the professional never replied to contributes nothing', () => {
  const noReply = {
    messages: [
      { id: 'c', sender: 'client' as const, kind: 'text' as const, body: 'hi', createdAt: NOW.toISOString() },
    ],
  };
  const rs = replySpeed([thread(5), thread(5), thread(5), thread(5), thread(5), noReply], NOW);
  expect(rs).toEqual({ medianMinutes: 5, sampleSize: 5 });
});
