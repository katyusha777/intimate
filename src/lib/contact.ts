/**
 * Support contact config — ONE place to change the numbers/handles.
 * `display` is what humans read; `href` is what taps open.
 */
export const SUPPORT_CONTACT = {
  whatsapp: {
    display: '085 333 2377',
    href: 'https://wa.me/31853332377',
  },
  telegram: {
    display: '085 333 2377',
    href: 'https://t.me/+31853332377',
  },
  /** Shown next to the channels — hours are copy, not logic. */
  hours: 'Mon–Fri 9:00–17:00',
} as const;
