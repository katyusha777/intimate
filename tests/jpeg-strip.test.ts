/**
 * The server-side EXIF/GPS strip (hard rule 2). A crafted upload must not keep
 * its metadata: the APP1/EXIF (and any APPn/COM) segment is dropped, pixels and
 * frame markers preserved.
 */
import { describe, expect, test } from 'bun:test';
import { stripJpegMetadata } from '../src/lib/jpeg-strip';

/** Build a tiny fake JPEG: SOI, an APP1 "EXIF" blob, a kept DQT segment, SOS+data, EOI. */
function jpegWithExif(): Uint8Array {
  const exifPayload = [...'Exif\0\0GPS-51.5,-0.1'].map((c) => c.charCodeAt(0));
  const app1Len = exifPayload.length + 2; // length field includes itself
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x11, 0x22]; // marker + len(4) + 2 payload
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, ...exifPayload, // APP1/EXIF
    ...dqt, // a non-APP segment that MUST survive
    0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, // SOS + fake scan data
    0xff, 0xd9, // EOI
  ]);
}

describe('stripJpegMetadata', () => {
  test('drops the APP1/EXIF segment, keeps frame data', () => {
    const src = jpegWithExif();
    const out = new Uint8Array(stripJpegMetadata(src.buffer));
    // No APP1 marker (0xFF 0xE1) survives.
    let hasApp1 = false;
    for (let i = 0; i + 1 < out.length; i++) if (out[i] === 0xff && out[i + 1] === 0xe1) hasApp1 = true;
    expect(hasApp1).toBe(false);
    // No "GPS" bytes survive.
    expect(Buffer.from(out).includes(Buffer.from('GPS'))).toBe(false);
    // SOI + EOI + the kept DQT segment survive.
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(Buffer.from(out).includes(Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x11, 0x22]))).toBe(true);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  test('non-JPEG input is returned untouched', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]).buffer;
    expect(new Uint8Array(stripJpegMetadata(png))).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]));
  });

  test('a clean JPEG (no metadata) is preserved byte-for-byte', () => {
    const clean = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x11, 0x22, 0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xff, 0xd9]);
    expect(new Uint8Array(stripJpegMetadata(clean.buffer))).toEqual(clean);
  });
});
