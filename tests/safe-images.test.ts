import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import {
  NSFW_IMAGES,
  SAFE_IMAGES,
  neutralImageFor,
  nsfwImageFor,
  safeImageFor,
} from '../src/lib/safe-images';

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

test('neutral placeholder is a deterministic, decodable SVG data-URI', () => {
  const a = neutralImageFor('profile-1');
  expect(a).toBe(neutralImageFor('profile-1')); // stable per key
  expect(neutralImageFor('profile-2')).not.toBe(a); // spreads across keys (regression guard)
  expect(a.startsWith('data:image/svg+xml,')).toBe(true);
  const svg = decodeURIComponent(a.slice('data:image/svg+xml,'.length));
  expect(svg).toContain('<svg');
  expect(svg).toContain("fill='url(#g)'"); // gradient ref survives encode/decode
});
