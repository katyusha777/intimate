import { describe, expect, test } from 'bun:test';
import { wrapSelectRetry } from '../src/db/client';

/** Stub for postgres-js `unsafe`: fails the first `fails` calls, then resolves. */
function stub(fails: number) {
  let calls = 0;
  const raw = (() => {
    calls++;
    const p = calls <= fails ? Promise.reject(new Error('boom')) : Promise.resolve(['row']);
    p.catch(() => {}); // silence unhandled-rejection noise from the stub itself
    return Object.assign(p, { values: () => p });
  }) as unknown as Parameters<typeof wrapSelectRetry>[0];
  return { raw, calls: () => calls };
}

describe('wrapSelectRetry', () => {
  test('select retries once and succeeds', async () => {
    const s = stub(1);
    const unsafe = wrapSelectRetry(s.raw);
    expect(await unsafe('select 1')).toEqual(['row']);
    expect(s.calls()).toBe(2);
  });

  test('select failing twice rejects (no infinite retry)', async () => {
    const s = stub(2);
    const unsafe = wrapSelectRetry(s.raw);
    await expect(Promise.resolve(unsafe('select 1'))).rejects.toThrow('boom');
    expect(s.calls()).toBe(2);
  });

  test('values() path also retries', async () => {
    const s = stub(1);
    const unsafe = wrapSelectRetry(s.raw);
    expect(await (unsafe('select 1') as { values(): Promise<unknown> }).values()).toEqual(['row']);
    expect(s.calls()).toBe(2);
  });

  test('writes are never retried', async () => {
    const s = stub(1);
    const unsafe = wrapSelectRetry(s.raw);
    await expect(Promise.resolve(unsafe('insert into t values (1)'))).rejects.toThrow('boom');
    expect(s.calls()).toBe(1);
  });
});
