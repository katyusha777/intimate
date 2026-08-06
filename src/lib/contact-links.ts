/**
 * Builds safe tap-to-contact links from a profile's raw contact handles.
 * Handles are UGC (hard rule 7) — each is sanitized to its channel's legal
 * charset before it ever lands in an href, so a hostile value can't break out
 * into a different URL/scheme. Returns only the channels she actually filled in.
 */
import type { Profile } from '@/app/models/profile';

export type ContactKind = 'whatsapp' | 'telegram' | 'instagram' | 'phone';
export interface ContactLink {
  kind: ContactKind;
  href: string;
  /** The handle/number as shown on the button. */
  display: string;
  /** Icon name + family for atoms/Icon. */
  icon: string;
  family: 'thin' | 'brands';
}

const digits = (v: string) => v.replace(/[^\d]/g, '');
// Telegram/Instagram usernames: letters, digits, underscore/dot only.
const handle = (v: string, extra = '') =>
  v.replace(/^@+/, '').replace(new RegExp(`[^A-Za-z0-9_${extra}]`, 'g'), '');

export function contactLinks(p: Profile): ContactLink[] {
  const out: ContactLink[] = [];
  const wa = p.whatsapp ? digits(p.whatsapp) : '';
  if (wa) out.push({ kind: 'whatsapp', href: `https://wa.me/${wa}`, display: 'WhatsApp', icon: 'whatsapp', family: 'brands' });

  const tg = p.telegram ? handle(p.telegram) : '';
  if (tg) out.push({ kind: 'telegram', href: `https://t.me/${tg}`, display: 'Telegram', icon: 'telegram', family: 'brands' });

  const ig = p.instagram ? handle(p.instagram, '.') : '';
  if (ig) out.push({ kind: 'instagram', href: `https://instagram.com/${ig}`, display: 'Instagram', icon: 'instagram', family: 'brands' });

  const tel = p.phone ? p.phone.replace(/[^\d+]/g, '') : '';
  if (tel) out.push({ kind: 'phone', href: `tel:${tel}`, display: tel, icon: 'phone', family: 'thin' });

  return out;
}
