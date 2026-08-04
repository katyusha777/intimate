/**
 * Support contact config — ONE place to change the numbers/handles.
 * `display` is what humans read; `href` is what taps open.
 */
export const SUPPORT_CONTACT = {
  phone: {
    display: '085 333 2377',
    href: 'tel:+31853332377',
  },
  whatsapp: {
    display: '085 333 2377',
    href: 'https://wa.me/31853332377',
  },
  telegram: {
    display: '@intimatenl',
    href: 'https://t.me/intimatenl',
  },
  email: {
    display: 'hi@intimate.nl',
    href: 'mailto:hi@intimate.nl',
  },
  /** Shown next to the channels — hours are copy, not logic. */
  hours: 'Mon–Fri 9:00–17:00 · Sat–Sun 12:00–15:00',
  /** Legacy intimate.nl operator details — confirm before a real launch. */
  company: 'Optiweb · Poyckstraat 141, 6463 BG Kerkrade · KvK 69731977',
} as const;
