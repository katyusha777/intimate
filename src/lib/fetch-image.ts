/**
 * Trust-boundary fetch of an EXTERNAL image URL (LLM-extracted from crawled
 * agency pages — attacker-influenced). The ONE copy of the guard chain: the
 * crawler's photo import (app/data/db/crawl.ts) and the admin preview proxy
 * (pages/admin/imgproxy.ts) both route here, so an SSRF-guard hardening can't
 * land in one and miss the other. Workers egress can't reach private nets —
 * the guard is defense-in-depth, not the only wall.
 */
import { env } from 'cloudflare:workers';

export const imagesBinding = () => (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;

const MAX_BYTES = 15_000_000;
// IPv4 private/loopback/link-local (incl. cloud metadata 169.254.*), 0.*, and
// any IPv6 literal (bracketed hostname) — external images have no business there.
const PRIVATE_HOST =
  /^(localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/;

/** Fetch + validate an external image; null on any rejection (never throws). */
export async function fetchExternalImage(
  rawUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (PRIVATE_HOST.test(url.hostname)) return null;
  try {
    const res = await fetch(url.href, { headers: { accept: 'image/*' } });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.startsWith('image/')) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

/**
 * Re-encode through the Images binding — strips ALL metadata (EXIF GPS, hard
 * rule 2) and normalizes format. Null when the binding is missing or the
 * transform fails; callers decide whether the original may serve instead
 * (preview: yes; storage: never).
 */
export async function transformImage(
  bytes: ArrayBuffer,
  opts: { width: number; format: 'image/jpeg' | 'image/webp'; quality: number },
): Promise<ArrayBuffer | null> {
  const IMAGES = imagesBinding();
  if (!IMAGES) return null;
  try {
    const out = await IMAGES.input(new Response(bytes).body!)
      .transform({ width: opts.width })
      .output({ format: opts.format, quality: opts.quality });
    return await out.response().arrayBuffer();
  } catch {
    return null;
  }
}
