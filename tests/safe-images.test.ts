import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { NSFW_IMAGES, SAFE_IMAGES, nsfwImageFor, safeImageFor } from '../src/lib/safe-images';

const listDir = (dir: string, prefix: string) =>
  readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => `${prefix}${f}`)
    .sort();

test('SAFE_IMAGES matches public/safeimg/ contents', () => {
  expect([...SAFE_IMAGES].sort()).toEqual(listDir('public/safeimg', '/safeimg/'));
});

test('NSFW_IMAGES matches public/nsfwimg/ contents', () => {
  expect([...NSFW_IMAGES].sort()).toEqual(listDir('public/nsfwimg', '/nsfwimg/'));
});

test('image picks are deterministic and in range', () => {
  expect(safeImageFor('profile-1')).toBe(safeImageFor('profile-1'));
  expect(SAFE_IMAGES).toContain(safeImageFor('anything'));
  expect(nsfwImageFor('profile-1')).toBe(nsfwImageFor('profile-1'));
  expect(NSFW_IMAGES).toContain(nsfwImageFor('anything'));
});
