/**
 * Server-side JPEG metadata strip (hard rule 2 — defence in depth).
 *
 * The client already re-encodes uploads through a canvas (lib/reencode.ts),
 * which drops EXIF/GPS. But a CRAFTED client POST can bypass that and ship a
 * data-URL with the original EXIF/GPS intact — and for a sex-worker directory a
 * leaked GPS tag deanonymises. So EVERY image the server ingests (profile
 * photos, verification docs, chat photos) is re-stripped here before it is
 * stored or re-served. Workerd-safe: pure byte walk, no DOM, no bindings.
 *
 * Approach: walk the JPEG segment markers and DROP every APPn (0xFFE0–0xFFEF —
 * EXIF, XMP, ICC, IPTC, JFIF) and COM (comment) segment. Pixels are untouched,
 * so this never re-compresses; it only removes the metadata containers where
 * location/identity data lives. A non-JPEG or malformed input is returned/served
 * as-is or truncated safely (a broken image can't render — no leak either way).
 */

/** Return a copy of `input` with all APPn + comment segments removed. */
export function stripJpegMetadata(input: ArrayBufferLike): ArrayBuffer {
  const b = new Uint8Array(input);
  // Not a JPEG (SOI 0xFFD8) → nothing we know how to strip; leave untouched.
  if (b.length < 2 || b[0] !== 0xff || b[1] !== 0xd8) return b.slice().buffer;
  const out = new Uint8Array(b.length); // output is only ever ≤ input (we drop)
  let w = 0;
  const copy = (start: number, end: number) => {
    out.set(b.subarray(start, end), w);
    w += end - start;
  };
  out[w++] = 0xff;
  out[w++] = 0xd8; // SOI
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      // Out of sync with the marker structure — copy the remainder verbatim.
      copy(i, b.length);
      break;
    }
    const marker = b[i + 1];
    if (marker === 0xd9) {
      out[w++] = 0xff;
      out[w++] = 0xd9; // EOI
      break;
    }
    if (marker === 0xda) {
      // SOS — entropy-coded scan data runs to EOI; copy the rest verbatim.
      copy(i, b.length);
      break;
    }
    if (i + 3 >= b.length) {
      // Truncated segment length — bail safely, keep what's left.
      copy(i, b.length);
      break;
    }
    const len = (b[i + 2] << 8) | b[i + 3]; // big-endian, includes the 2 length bytes
    const seg = 2 + len; // marker (2) + length+payload (len)
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe; // APPn or COM
    if (!drop) copy(i, Math.min(i + seg, b.length));
    i += seg;
  }
  return out.slice(0, w).buffer;
}

/** Same, for a `data:image/jpeg;base64,…` URL (chat photos store the URL inline). */
export function stripJpegDataUrl(dataUrl: string): string {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  const stripped = new Uint8Array(stripJpegMetadata(bytes.buffer));
  let s = '';
  // Chunked to keep the binary→string conversion off the call stack for ~1 MB.
  for (let k = 0; k < stripped.length; k += 0x8000) {
    s += String.fromCharCode(...stripped.subarray(k, k + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(s)}`;
}
