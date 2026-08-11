import { expect, test } from 'bun:test';
import { emailSignatureHtml, type SignatureInput } from '@/lib/email-signature';

const base: SignatureInput = { name: 'X', position: '', phone: '', email: '', whatsapp: '', telegram: '', image: '' };

test('escapes user text — no HTML injection', () => {
  const html = emailSignatureHtml({ ...base, name: 'A<b> & "c"', position: '<i>x</i>' });
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('<i>');
  expect(html).toContain('A&lt;b&gt; &amp; &quot;c&quot;');
});

test('photo cell present only with an image', () => {
  expect(emailSignatureHtml(base)).not.toContain('<img src="https://ex');
  expect(emailSignatureHtml({ ...base, image: 'https://ex/x.jpg' })).toContain('src="https://ex/x.jpg"');
});

test('contact icons render only when filled, with correct hrefs', () => {
  const html = emailSignatureHtml({
    ...base,
    phone: '+31 6 1234 5678',
    email: 'anna@intimate.nl',
    whatsapp: '+31 (6) 1234-5678',
    telegram: '@anna',
  });
  expect(html).toContain('tel:+31612345678'); // stripped to digits + leading +
  expect(html).toContain('mailto:anna@intimate.nl');
  expect(html).toContain('https://wa.me/31612345678'); // digits only, no +
  expect(html).toContain('https://t.me/anna'); // leading @ dropped in href
});

test('no contact chips when nothing is filled (wordmark still present)', () => {
  const html = emailSignatureHtml(base);
  expect(html).not.toContain('/phone.png');
  expect(html).not.toContain('/telegram.png');
  expect(html).toContain('/logo.png'); // the wordmark strip always renders
});

test('blank name falls back to placeholder', () => {
  expect(emailSignatureHtml({ ...base, name: '  ' })).toContain('Your name');
});
