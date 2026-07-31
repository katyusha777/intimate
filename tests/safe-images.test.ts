import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { SAFE_IMAGES, safeImageFor } from '../src/lib/safe-images';

test('SAFE_IMAGES matches public/safeimg/ contents', () => {
  const onDisk = readdirSync('public/safeimg')
    .filter((f) => !f.startsWith('.'))
    .map((f) => `/safeimg/${f}`)
    .sort();
  expect([...SAFE_IMAGES].sort()).toEqual(onDisk);
});

test('safeImageFor is deterministic and in range', () => {
  expect(safeImageFor('profile-1')).toBe(safeImageFor('profile-1'));
  expect(SAFE_IMAGES).toContain(safeImageFor('anything'));
});
