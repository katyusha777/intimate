/**
 * TURN credential minting (VIDEO-CALLING.md §8, TURN-SERVER.md): coturn's
 * `use-auth-secret` REST convention — username = "<unix-expiry>:<session-id>",
 * credential = base64(HMAC-SHA1(secret, username)), TTL ≤ 1h. WebCrypto only
 * (runs on workerd). Pure over its inputs so tests can pin the formula.
 *
 * No secret configured → public-STUN-only fallback (calls still work on easy
 * NATs; the professional's relay-only privacy rule needs the secret).
 */

export const TURN_HOST = 'turn.intimate.nl';

export interface IceConfig {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  /** True when TURN is live → the professional side forces relay (her IP never
   *  reaches the client). The client side always keeps 'all'. */
  relayAvailable: boolean;
}

export async function mintIceServers(
  secret: string | undefined,
  sessionId: string,
  now: Date,
  ttlS = 3600,
): Promise<IceConfig> {
  if (!secret) {
    return { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], relayAvailable: false };
  }
  const username = `${Math.floor(now.getTime() / 1000) + ttlS}:${sessionId}`;
  const credential = await hmacSha1Base64(secret, username);
  return {
    iceServers: [
      { urls: `stun:${TURN_HOST}:3478` },
      {
        urls: [
          `turn:${TURN_HOST}:3478?transport=udp`,
          `turn:${TURN_HOST}:3478?transport=tcp`,
          `turns:${TURN_HOST}:443?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
    relayAvailable: true,
  };
}

export async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
