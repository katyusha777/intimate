/**
 * One-time welcome DM from "Team Intimate" to a new professional (feedback v7
 * #7). Team Intimate is a fixed system account that sits on the CLIENT side of
 * the thread, so the message lands in her inbox and she can just reply.
 *
 * The copy is an inline per-locale record, NOT the Paraglide pipeline — it's a
 * single internal system string, and one short message doesn't earn five JSON
 * keys. Support number comes from the one config (lib/contact.ts).
 *
 * ponytail: admin-side reply (posting back AS Team Intimate) is not built yet —
 * replies are readable via /admin/messaging oversight. Add a reply box there
 * when we actually staff the inbox.
 */
import { SUPPORT_CONTACT } from '@/lib/contact';
import type { Locale } from '@/lib/taxonomy';

/** Fixed UUID for the system sender (…feed). Self-bootstrapped on first use. */
export const TEAM_INTIMATE_ACCOUNT_ID = '00000000-0000-4000-8000-00000000feed';
export const TEAM_INTIMATE_NAME = 'Team Intimate';

/** Short, warm welcome in the professional's locale (falls back to Dutch). */
export function welcomeBody(locale: Locale): string {
  const phone = SUPPORT_CONTACT.phone.display;
  const byLocale: Record<Locale, string> = {
    nl: `Welkom bij Intimate! 🎉 Wij zijn de nieuwe, geverifieerde plek voor onafhankelijke professionals in Nederland — snel, discreet en alleen echte, gecontroleerde profielen. Vragen of hulp nodig? Antwoord gewoon hier, of bel ons team op ${phone}. Fijn dat je er bent!`,
    en: `Welcome to Intimate! 🎉 We're the new, verified home for independent professionals in the Netherlands — fast, discreet, and real profiles only. Any questions or need a hand? Just reply here, or call our team on ${phone}. Glad to have you!`,
    de: `Willkommen bei Intimate! 🎉 Wir sind der neue, verifizierte Ort für unabhängige Profis in den Niederlanden — schnell, diskret und nur echte, geprüfte Profile. Fragen oder Hilfe nötig? Antworte einfach hier oder ruf unser Team unter ${phone} an. Schön, dass du da bist!`,
    ro: `Bine ai venit pe Intimate! 🎉 Suntem noul loc verificat pentru profesioniști independenți din Țările de Jos — rapid, discret și doar profiluri reale, verificate. Ai întrebări sau ai nevoie de ajutor? Răspunde aici sau sună echipa noastră la ${phone}. Ne bucurăm că ești aici!`,
    it: `Benvenuta su Intimate! 🎉 Siamo il nuovo spazio verificato per professionisti indipendenti nei Paesi Bassi — veloce, discreto e solo profili reali e verificati. Domande o bisogno di aiuto? Rispondi qui o chiama il nostro team al ${phone}. Felici di averti con noi!`,
  };
  return byLocale[locale] ?? byLocale.nl;
}
