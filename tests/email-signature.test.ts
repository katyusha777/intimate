import { expect, test } from 'bun:test';
import { emailSignatureHtml } from '@/lib/email-signature';

test('escapes user text — no HTML injection', () => {
  const html = emailSignatureHtml({ name: 'A<b> & "c"', position: '<i>x</i>', image: '' });
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('<i>');
  expect(html).toContain('A&lt;b&gt; &amp; &quot;c&quot;');
});

test('image cell present only with an image', () => {
  expect(emailSignatureHtml({ name: 'X', position: '', image: '' })).not.toContain('<img');
  expect(emailSignatureHtml({ name: 'X', position: '', image: 'https://i/x.jpg' })).toContain('src="https://i/x.jpg"');
});

test('position line omitted when blank', () => {
  expect(emailSignatureHtml({ name: 'X', position: '', image: '' })).not.toContain('#636363');
  expect(emailSignatureHtml({ name: 'X', position: 'CEO', image: '' })).toContain('CEO');
});

test('blank name falls back to placeholder', () => {
  expect(emailSignatureHtml({ name: '  ', position: '', image: '' })).toContain('Your name');
});
