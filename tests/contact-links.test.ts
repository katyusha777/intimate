import { expect, test } from 'bun:test';
import { contactLinks } from '../src/lib/contact-links';
import type { Profile } from '../src/app/models/profile';

const mk = (o: Partial<Profile>) => contactLinks({ ...o } as Profile);

test('sanitizes handles into safe hrefs', () => {
  const links = mk({
    whatsapp: '+31 6 1234-5678',
    telegram: '@some_handle',
    instagram: 'insta.user',
    phone: '020 555 0000',
  });
  const by = Object.fromEntries(links.map((l) => [l.kind, l.href]));
  expect(by.whatsapp).toBe('https://wa.me/31612345678');
  expect(by.telegram).toBe('https://t.me/some_handle');
  expect(by.instagram).toBe('https://instagram.com/insta.user');
  expect(by.phone).toBe('tel:0205550000');
});

test('strips hostile characters — no scheme/URL breakout', () => {
  const [tg] = mk({ telegram: 'evil/../x?q=1 javascript:alert(1)' });
  expect(tg!.href).toBe('https://t.me/evilxq1javascriptalert1');
});

test('omits channels she left blank', () => {
  expect(mk({ whatsapp: '   ' })).toHaveLength(0);
  expect(mk({})).toHaveLength(0);
});
