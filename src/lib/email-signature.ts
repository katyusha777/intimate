/**
 * Email-safe signature HTML for the admin Tools builder, laid out like the
 * Surfe reference: round photo on the left; name / position / intimate.nl on
 * the right; then a bottom strip with the Intimate wordmark and the contact
 * icons in a single row.
 *
 * Table layout + inline styles ONLY (email clients strip <style> and ignore CSS
 * vars); all imagery is hosted PNG at absolute URLs (Gmail strips SVG). Palette
 * baked in as literal hex: #0a0a0a = --foreground / app-icon tile, #636363 =
 * muted, #d50323 = --brand. Icons + wordmark come from public/img/signature/
 * (see scripts/gen-signature-assets.ts).
 *
 * Pure + DOM-free so the builder island and its test share one source. All user
 * text is HTML-escaped — a name with < or " must not break the markup.
 */
const A = 'https://intimate.nl/img/signature';
const FONT = 'Arial, Helvetica, sans-serif';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One icon in the bottom contact strip (icon-only, like Surfe's social row). */
function chip(icon: string, href: string): string {
  return (
    `<td style="vertical-align:middle;padding-right:9px;">` +
    `<a href="${esc(href)}"><img src="${A}/${icon}.png" alt="${icon}" width="22" height="22" style="display:block;border:0;" /></a></td>`
  );
}

export interface SignatureInput {
  name: string;
  position: string;
  phone: string;
  email: string;
  whatsapp: string;
  telegram: string;
  image: string;
}

export function emailSignatureHtml(input: SignatureInput): string {
  const name = input.name.trim();
  const position = input.position.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const whatsapp = input.whatsapp.trim();
  const telegram = input.telegram.trim().replace(/^@/, '');
  const image = input.image.trim();

  const tel = phone.replace(/[^\d+]/g, '');
  const wa = whatsapp.replace(/[^\d]/g, '');
  const chips =
    (phone ? chip('phone', `tel:${tel}`) : '') +
    (email ? chip('email', `mailto:${email}`) : '') +
    (wa ? chip('whatsapp', `https://wa.me/${wa}`) : '') +
    (telegram ? chip('telegram', `https://t.me/${telegram}`) : '');

  const photoCell = image
    ? `    <td style="vertical-align:middle;padding-right:22px;">` +
      `<img src="${esc(image)}" alt="${esc(name)}" width="112" height="112" style="display:block;width:112px;height:112px;border-radius:50%;object-fit:cover;border:0;" /></td>\n`
    : '';

  // Bottom strip: wordmark + the contact icons, all on one middle-aligned row.
  const strip =
    `      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">\n` +
    `        <tr>\n` +
    `          <td style="vertical-align:middle;padding-right:16px;">` +
    `<a href="https://intimate.nl"><img src="${A}/logo.png" alt="Intimate" width="59" height="28" style="display:block;border:0;" /></a></td>\n` +
    (chips ? `          ${chips}\n` : '') +
    `        </tr>\n` +
    `      </table>`;

  return (
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:${FONT};color:#0a0a0a;">\n` +
    `  <tr>\n` +
    photoCell +
    `    <td style="vertical-align:middle;font-family:${FONT};">\n` +
    `      <div style="font-size:22px;font-weight:bold;color:#0a0a0a;line-height:1.15;">${esc(name) || 'Your name'}</div>\n` +
    (position ? `      <div style="font-size:15px;color:#636363;padding-top:3px;">${esc(position)}</div>\n` : '') +
    `      <div style="font-size:13px;font-weight:bold;padding-top:3px;"><a href="https://intimate.nl" style="color:#0a0a0a;text-decoration:none;">intimate.nl</a></div>\n` +
    `      <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>\n` +
    strip +
    `\n    </td>\n` +
    `  </tr>\n` +
    `</table>`
  );
}
