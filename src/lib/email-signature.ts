/**
 * Email-safe signature HTML for the admin Tools builder. Table layout + inline
 * styles ONLY (email clients strip <style> and ignore CSS vars), brand palette
 * baked in as literal hex: #d50323 = --brand, #0a0a0a = --foreground, #636363 =
 * muted. Pure + DOM-free so the builder island and its test share one source.
 * All user text is HTML-escaped — a name with < or " must not break the markup.
 */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function emailSignatureHtml(input: { name: string; position: string; image: string }): string {
  const name = input.name.trim();
  const position = input.position.trim();
  const image = input.image.trim();
  const imgCell = image
    ? `      <td style="vertical-align:middle;padding-right:14px;">\n` +
      `        <img src="${esc(image)}" alt="${esc(name)}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:8px;object-fit:cover;" />\n` +
      `      </td>\n`
    : '';
  const posLine = position
    ? `        <div style="font-size:12px;color:#636363;padding-top:2px;">${esc(position)}</div>\n`
    : '';
  return (
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">\n` +
    `  <tr>\n` +
    imgCell +
    `    <td style="vertical-align:middle;border-left:3px solid #d50323;padding:2px 0 2px 14px;">\n` +
    `      <div style="font-size:16px;font-weight:bold;color:#0a0a0a;line-height:1.25;">${esc(name) || 'Your name'}</div>\n` +
    posLine +
    `      <div style="font-size:12px;padding-top:6px;">\n` +
    `        <a href="https://intimate.nl" style="color:#d50323;text-decoration:none;font-weight:bold;letter-spacing:.02em;">intimate.nl</a>\n` +
    `      </div>\n` +
    `    </td>\n` +
    `  </tr>\n` +
    `</table>`
  );
}
