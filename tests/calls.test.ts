/**
 * Calls domain checks (docs/VIDEO-CALLING.md): the TURN credential formula
 * (must match coturn's use-auth-secret HMAC-SHA1 convention — TURN-SERVER.md)
 * and the call state machine the action layer enforces.
 */
import { describe, expect, test } from 'bun:test';
import { hmacSha1Base64, mintIceServers } from '../src/lib/turn';
import { canTransition, CALL_CARD_BODY } from '../src/app/models/call';
import { CALL_STATES } from '../src/lib/taxonomy';

describe('turn credentials', () => {
  test('hmac-sha1 matches the RFC 2202 test vector', async () => {
    // RFC 2202 case 2: key "Jefe", data "what do ya want for nothing?"
    // digest = effcdf6ae5eb2fa2d27416d5f184df9c259a7c79
    const rfcHex = 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79';
    const rfcB64 = btoa(String.fromCharCode(...rfcHex.match(/../g)!.map((h) => parseInt(h, 16))));
    expect(await hmacSha1Base64('Jefe', 'what do ya want for nothing?')).toBe(rfcB64);
  });

  test('mints coturn-convention creds with TTL-bounded username', async () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const cfg = await mintIceServers('s3cret', 'call-123', now, 3600);
    expect(cfg.relayAvailable).toBe(true);
    const turn = cfg.iceServers[1]!;
    expect(turn.username).toBe(`${Math.floor(now.getTime() / 1000) + 3600}:call-123`);
    expect(turn.credential).toBe(await hmacSha1Base64('s3cret', turn.username!));
    expect(turn.urls).toContain('turns:turn.intimate.nl:443?transport=tcp');
  });

  test('no secret → stun-only, no relay promise', async () => {
    const cfg = await mintIceServers(undefined, 'x', new Date());
    expect(cfg.relayAvailable).toBe(false);
    expect(cfg.iceServers).toHaveLength(1);
  });
});

describe('call state machine', () => {
  test('ringing can be answered, declined, missed or failed — never re-rung', () => {
    expect(canTransition('ringing', 'active')).toBe(true);
    expect(canTransition('ringing', 'declined')).toBe(true);
    expect(canTransition('ringing', 'timeout')).toBe(true);
    expect(canTransition('ringing', 'failed')).toBe(true);
    expect(canTransition('ringing', 'ended')).toBe(false);
  });

  test('active only ends or fails; terminal states are dead ends', () => {
    expect(canTransition('active', 'ended')).toBe(true);
    expect(canTransition('active', 'failed')).toBe(true);
    expect(canTransition('active', 'ringing')).toBe(false);
    // A 'timeout' is a MISSED (never-answered) call — it can't apply to an
    // answered one. calls.end() enforces this by restricting the timeout reason
    // to the ringing source state, so a stale caller-side ring timer can't post
    // a bogus 0s "ended" card for a call that actually connected.
    expect(canTransition('active', 'timeout')).toBe(false);
    for (const from of ['ended', 'declined', 'timeout', 'failed'] as const) {
      for (const to of CALL_STATES) expect(canTransition(from, to)).toBe(false);
    }
  });

  test('every terminal state except failed-from-sweep posts a thread card', () => {
    expect(CALL_CARD_BODY.ended).toBeTruthy();
    expect(CALL_CARD_BODY.declined).toBeTruthy();
    expect(CALL_CARD_BODY.timeout).toBeTruthy();
    expect(CALL_CARD_BODY.failed).toBeTruthy();
    expect(CALL_CARD_BODY.active).toBeUndefined();
  });
});
