/**
 * Email-safe signature HTML for the admin Tools builder. Table layout + inline
 * styles ONLY (email clients strip <style> and ignore CSS vars); all imagery is
 * hosted PNG at absolute URLs (Gmail strips SVG). Brand palette baked in as
 * literal hex: #d50323 = --brand, #0a0a0a = --foreground, #636363 = muted.
 * Icons + wordmark come from public/img/signature/ (see scripts/gen-signature-assets.ts).
 *
 * Pure + DOM-free so the builder island and its test share one source. All user
 * text is HTML-escaped — a name with < or " must not break the markup.
 */
const A = 'https://intimate.nl/img/signature';
const FONT = 'Arial, Helvetica, sans-serif';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One contact line: icon + label in TWO middle-aligned cells so the glyph and
 * text sit centred on the same baseline in every client (inline vertical-align
 * is unreliable in Outlook/Gmail — two <td>s are not).
 */
function row(icon: string, href: string, label: string): string {
  return (
    `        <tr>` +
    `<td width="30" style="vertical-align:middle;padding:5px 0;">` +
    `<a href="${esc(href)}"><img src="${A}/${icon}.png" alt="" width="22" height="22" style="display:block;border:0;" /></a></td>` +
    `<td style="vertical-align:middle;padding:5px 0;">` +
    `<a href="${esc(href)}" style="color:#0a0a0a;text-decoration:none;font-family:${FONT};font-size:13px;">${esc(label)}</a></td>` +
    `</tr>\n`
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
  const rows =
    (phone ? row('phone', `tel:${tel}`, phone) : '') +
    (email ? row('email', `mailto:${email}`, email) : '') +
    (wa ? row('whatsapp', `https://wa.me/${wa}`, 'WhatsApp') : '') +
    (telegram ? row('telegram', `https://t.me/${telegram}`, `@${telegram}`) : '');

  const photoCell = image
    ? `      <td style="vertical-align:top;padding-right:16px;">` +
      `<img src="${esc(image)}" alt="${esc(name)}" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:10px;object-fit:cover;border:0;" /></td>\n`
    : '';

  const contactTable = rows
    ? `\n      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-top:10px;">\n${rows}      </table>`
    : '';

  return (
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:${FONT};color:#0a0a0a;">\n` +
    `  <tr><td colspan="2" style="padding-bottom:10px;">` +
    `<a href="https://intimate.nl"><img src="${A}/logo.png" alt="Intimate" width="100" height="48" style="display:block;border:0;" /></a></td></tr>\n` +
    `  <tr><td colspan="2" style="border-bottom:2px solid #d50323;font-size:0;line-height:0;">&nbsp;</td></tr>\n` +
    `  <tr><td colspan="2" style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>\n` +
    `  <tr>\n` +
    photoCell +
    `      <td style="vertical-align:top;font-family:${FONT};">` +
    `<div style="font-size:17px;font-weight:bold;color:#0a0a0a;line-height:1.2;">${esc(name) || 'Your name'}</div>` +
    (position ? `<div style="font-size:13px;color:#636363;padding-top:2px;">${esc(position)}</div>` : '') +
    contactTable +
    `</td>\n` +
    `  </tr>\n` +
    `</table>`
  );
}
