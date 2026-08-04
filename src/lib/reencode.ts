/**
 * Client-side image re-encode (browser only — imported from component <script>s).
 * Drawing a file through a canvas and reading it back as JPEG DROPS all metadata,
 * including EXIF/GPS (hard rule 2) — so nothing that could locate an advertiser
 * ever leaves her device. Shared by profile photos (MediaManager) and the
 * verification ID/selfie uploads (VerificationFlow). Returns a data URL.
 */
export async function reencode(file: File, maxDim = 1000, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
