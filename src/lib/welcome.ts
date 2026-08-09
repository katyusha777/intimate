/**
 * One-time welcome DM from "Team Intimate" to a new professional (feedback v7
 * #7). Team Intimate is a fixed system account that sits on the CLIENT side of
 * the thread, so the message lands in her inbox.
 *
 * The thread is READ-ONLY (owner decision 2026-08-10): nobody staffs this
 * inbox, so replies would vanish — the UI swaps the composer for the
 * WhatsApp/Telegram support chips and the send gate denies server-side.
 *
 * ONE bilingual body, Dutch first then English (owner decision) — not the
 * Paraglide pipeline; a single internal system string doesn't earn JSON keys.
 * Contact handles come from the one config (lib/contact.ts).
 */
import { SUPPORT_CONTACT } from '@/lib/contact';

/** Fixed UUID for the system sender (…feed). Self-bootstrapped on first use. */
export const TEAM_INTIMATE_ACCOUNT_ID = '00000000-0000-4000-8000-00000000feed';
export const TEAM_INTIMATE_NAME = 'Team Intimate';

/** Bilingual welcome (NL, then EN) — WhatsApp/Telegram, never "call". */
export function welcomeBody(): string {
  const wa = SUPPORT_CONTACT.whatsapp.display;
  const tg = SUPPORT_CONTACT.telegram.display;
  return [
    `Welkom bij Intimate! 🎉 Wij zijn de nieuwe, geverifieerde plek voor onafhankelijke professionals in Nederland — snel, discreet en alleen echte, gecontroleerde profielen. Vragen of hulp nodig? Stuur ons een appje op WhatsApp (${wa}) of Telegram (${tg}). Fijn dat je er bent!`,
    '',
    '—',
    '',
    `Welcome to Intimate! 🎉 We're the new, verified home for independent professionals in the Netherlands — fast, discreet, and real profiles only. Questions or need a hand? Message us on WhatsApp (${wa}) or Telegram (${tg}). Glad to have you!`,
  ].join('\n');
}
