/**
 * Static editorial/legal pages migrated from the legacy intimate.nl site.
 * Content lives here (not Paraglide — that's for short UI strings); pages render
 * it through ContentPage.astro. EN, NL and DE are authored; any unknown locale
 * falls back to EN via sitePage() so a page is never blank.
 *
 * Stack-specific copy (analytics, verification-doc handling) is written against
 * THIS app's architecture (PostHog, EU R2, auto-purge) — not the legacy tools.
 * Legal/company details carry over from intimate.nl (same operator) — confirm
 * before a real launch; `docs/SECURITY.md`/legal review owns final wording.
 */
export type Block =
  | { h: string }
  | { p: string }
  | { list: string[] }
  | { note: string };

export interface PageContent {
  title: string;
  description: string;
  updated?: string;
  body: Block[];
}

// Long-form content is authored in en/nl/de only; ro/it fall back to English
// via sitePage() below (translating legal pages is a legal-review task, not a
// string-file task).
type Locale = 'nl' | 'en' | 'de' | 'ro' | 'it';
export type PageSlug =
  | 'about'
  | 'safety'
  | 'profile-rules'
  | 'verification'
  | 'terms'
  | 'privacy'
  | 'app';

const en: Record<PageSlug, PageContent> = {
  about: {
    title: 'About Intimate',
    description: 'A verified-only platform for safe, fast, genuine adult connections in the Netherlands.',
    body: [
      { p: 'Intimate is a platform for safe, dynamic online connections — modern technology, speed and community in one place.' },
      { h: 'Our mission' },
      { p: 'We put safety, speed and real human interaction first: authenticity and privacy inside a genuine community, not anonymous mass participation.' },
      { h: 'Safety comes first' },
      { list: [
        'Verified-only — every advertiser passes a thorough verification procedure before going live.',
        'Active moderation — our team watches the community and responds quickly to reports.',
      ] },
      { h: 'Speed and technology' },
      { p: 'The platform is built to feel instant — managing your profile, browsing listings and posting updates should never make you wait.' },
      { h: 'Inclusive by default' },
      { p: 'Intimate is for everyone. Professionals, the LGBTQ+ community and everyone else are explicitly welcome, without judgment about the connections people seek.' },
    ],
  },
  safety: {
    title: 'Safety & awareness',
    description: 'What to watch for, when to walk away, and how to report abuse. Your safety comes first.',
    body: [
      { p: 'Your safety comes first, and your alertness makes a real difference. Here is what to watch for, when to leave, and how to report abuse.' },
      { h: 'Before your appointment' },
      { p: 'Unsure about someone’s age? Ask for ID. If you don’t get clarity, or the doubt lingers, leave — you don’t owe anyone an explanation.' },
      { p: 'Trust your instinct. If something feels off, it usually is. If it sounds too good to be true, it usually is.' },
      { h: 'When to leave immediately' },
      { list: [
        'The location is unhygienic or unsafe (a basement, a shed).',
        'Minors are present.',
        'You feel unsafe for any reason at all.',
      ] },
      { p: 'You don’t need proof and you don’t need a good reason. An uneasy feeling is enough.' },
      { h: 'Reporting abuse' },
      { p: 'Report abuse to the police, to Meld Misdaad Anoniem (anonymous crime reporting) and to us — use the report button on the profile, or email report@intimate.nl with as much detail as possible, including the location.' },
      { note: 'Contact with a minor, or someone working under coercion or threat: stop immediately, contact support and forward the message to report@intimate.nl. Where criminal activity is proven, we hand data to the authorities.' },
      { h: 'For sex workers' },
      { p: 'As a sex worker you can be vaccinated against hepatitis B free of charge at the GGD. Combine vaccination with condoms — that baseline works.' },
    ],
  },
  'profile-rules': {
    title: 'Profile rules',
    description: 'Respect, honesty and age standards — the rules every profile on Intimate follows.',
    body: [
      { h: 'Respect each other' },
      { p: 'Intimate is built on mutual respect. Discrimination, hate speech, intimidation and rudeness are not tolerated — no warnings, no grey area.' },
      { h: 'Be yourself' },
      { p: 'Present yourself honestly. Share only your own photos and videos, never others in frame without consent, and never content that infringes copyright.' },
      { h: 'Age' },
      { list: [
        'Minimum 18 to use the platform.',
        'Minimum 21 to advertise.',
        'Profiles that suggest the person is a minor may require verification.',
      ] },
      { h: 'Photos' },
      { p: 'Erotic photos are allowed; full nudity is not — genitals and nipples must stay covered. Only yourself in frame, no unauthorized brands or logos, no text or contact details.' },
      { p: 'Not allowed: images glorifying violence, explicit sexual acts, or shocking material.' },
      { h: 'Enforcement' },
      { p: 'We operate a zero-tolerance policy against illegal conduct: warnings, account blocks, profile removal, or reporting to the authorities.' },
    ],
  },
  verification: {
    title: 'Verification procedure',
    description: 'How advertiser verification works, what to submit, and how we keep your documents safe.',
    body: [
      { h: 'Why we verify' },
      { p: 'We check that advertisers are real, at least 21, and meet the guidelines — a safe, trustworthy environment for everyone. What you submit stays confidential and never appears on your listing.' },
      { h: 'Before you start: make a safe copy' },
      { p: 'Mask sensitive data on your ID first. We recommend the Dutch government’s KopieID tool to black out details such as your citizen service number (BSN).' },
      { h: 'What you submit' },
      { list: [
        'ID document — photo, date of birth, validity and document number visible.',
        'Selfie with ID — your face and the photo on the document clearly visible.',
        'Proof of presence — a photo holding a Dutch/Belgian newspaper or receipt no older than a week.',
        'Full photo — a clear, unedited image showing you at least to the waist.',
      ] },
      { h: 'What happens next' },
      { p: 'Our moderation team reviews submissions as quickly as possible. Once approved you receive a verification checkmark, which builds trust and increases your visibility.' },
      { h: 'Privacy and safety' },
      { note: 'Verification documents are encrypted, stored in the EU, accessible only to reviewers, every access is logged, and the originals are automatically deleted after the retention window. They are used only for verification — never shown on your profile.' },
    ],
  },
  terms: {
    title: 'Terms & conditions',
    description: 'The terms governing use of Intimate. The authoritative version is Dutch.',
    body: [
      { note: 'This is a plain-language summary. The authoritative version is Dutch.' },
      { h: 'Introduction' },
      { p: 'These terms apply to all visitors and users of Intimate. By using the platform, you accept them.' },
      { h: 'The service' },
      { p: 'Intimate connects users through profiles containing adult content. We are an advertising platform — we do not facilitate or mediate meetings, and give no guarantees about user conduct.' },
      { h: 'Age requirements' },
      { list: ['Minimum age to use the platform: 18.', 'Minimum age to advertise: 21.'] },
      { h: 'Conduct' },
      { p: 'Prohibited: threatening users, unlawful content, infringing intellectual property, fully nude imagery, sharing others’ personal data, and misuse of account credentials.' },
      { h: 'Zero tolerance' },
      { p: 'We act firmly against illegal prostitution, coercion, blackmail and any involvement of minors. Report suspicious activity to us or the authorities immediately.' },
      { h: 'Liability' },
      { p: 'Use of the platform is at your own risk. Intimate accepts no liability for user conduct, contact between members, or technical failures.' },
      { h: 'Governing law' },
      { p: 'Dutch law applies; disputes fall under the competent Dutch court.' },
    ],
  },
  privacy: {
    title: 'Privacy & cookies',
    description: 'How Intimate handles your data, your GDPR rights, and our cookie-free analytics.',
    body: [
      { h: 'Basic principles' },
      { p: 'We are GDPR-minimal: we collect only what a feature needs and keep it only as long as needed. We do not sell your data or share it with advertisers.' },
      { h: 'Data we process' },
      { list: [
        'On registration: email (or phone) and IP, to create and secure your account.',
        'On profile management: what you provide yourself. Profile content is visible to other users.',
        'On verification (advertisers): identity documents, handled as below.',
      ] },
      { h: 'Verification documents' },
      { p: 'Encrypted, stored in the EU, accessible only to reviewers with every access logged, and automatically deleted after the retention window. They never appear on your profile.' },
      { h: 'Cookies & analytics' },
      { p: 'No advertising or cross-site tracking cookies. We use privacy-first product analytics to understand aggregate usage; session replay is permanently off on visitor and client surfaces. Only functional data (login, language, age-gate, security) is stored without consent, as the law permits.' },
      { h: 'Your rights (GDPR)' },
      { p: 'Access, correction, erasure, restriction, objection, portability and withdrawal of consent. Email privacy@intimate.nl; we respond within one month. You may also complain to the Autoriteit Persoonsgegevens.' },
    ],
  },
  app: {
    title: 'Get the Intimate app',
    description: 'The full Intimate experience on your phone — faster, with notifications, installable in seconds.',
    body: [
      { h: 'Everything you know, now in your pocket' },
      { p: 'Website or app, you get the same complete Intimate experience: instant chat, video and audio calls, listings you can post and browse, and your timeline of updates.' },
      { h: 'Why install it?' },
      { list: [
        'Access anywhere — optimized for mobile, so everything opens faster and feels more natural than a browser tab.',
        'Never miss anything — get a notification the moment a new message, reply or match arrives.',
        'Privacy built in — modern security protecting your personal data.',
      ] },
      { h: 'Install in seconds' },
      { p: 'Open Intimate in your phone’s browser, then use “Add to Home Screen” from the share menu. Intimate then sits on your device as an app, ready to use — no app store needed.' },
    ],
  },
};

const nl: Record<PageSlug, PageContent> = {
  about: {
    title: 'Over Intimate',
    description: 'Een platform met alleen geverifieerde profielen voor veilige, snelle en echte connecties in Nederland.',
    body: [
      { p: 'Intimate is een platform voor veilige, dynamische online connecties — moderne technologie, snelheid en gemeenschapszin op één plek.' },
      { h: 'Onze missie' },
      { p: 'We stellen veiligheid, snelheid en echte menselijke interactie voorop: authenticiteit en privacy binnen een echte gemeenschap, geen anonieme massa.' },
      { h: 'Veiligheid op de voorgrond' },
      { list: [
        'Alleen geverifieerd — elke adverteerder doorloopt een uitgebreide verificatie voordat het profiel live gaat.',
        'Actieve moderatie — ons team houdt de gemeenschap in de gaten en reageert snel op meldingen.',
      ] },
      { h: 'Snelheid en technologie' },
      { p: 'Het platform voelt direct — je profiel beheren, advertenties bekijken en updates plaatsen laat je nooit wachten.' },
      { h: 'Inclusiviteit als standaard' },
      { p: 'Intimate is er voor iedereen. Professionals, de LGBTQ+-gemeenschap en alle anderen zijn nadrukkelijk welkom, zonder oordeel over de connecties die mensen zoeken.' },
    ],
  },
  safety: {
    title: 'Veiligheid & bewustwording',
    description: 'Waar je op moet letten, wanneer je weg moet lopen, en hoe je misbruik meldt. Jouw veiligheid staat voorop.',
    body: [
      { p: 'Jouw veiligheid staat voorop, en jouw oplettendheid maakt echt verschil. Hier lees je waar je op moet letten, wanneer je weg moet lopen, en hoe je misbruik meldt.' },
      { h: 'Voor je afspraak' },
      { p: 'Twijfel je over iemands leeftijd? Vraag om een identiteitsbewijs. Krijg je geen duidelijkheid, of blijft het knagen? Vertrek dan — je hoeft je niet te verantwoorden.' },
      { p: 'Vertrouw je gevoel. Klopt er iets niet, dan klopt er meestal iets niet. Klinkt iets te mooi om waar te zijn, dan is dat meestal ook zo.' },
      { h: 'Wanneer je meteen moet vertrekken' },
      { list: [
        'De locatie is onhygiënisch of onveilig (een kelder, een schuurtje).',
        'Er zijn minderjarigen aanwezig.',
        'Je voelt je om welke reden dan ook onveilig.',
      ] },
      { p: 'Je hebt geen bewijs nodig en geen goede reden. Een onprettig gevoel is genoeg.' },
      { h: 'Misbruik melden' },
      { p: 'Meld misbruik bij de politie, bij Meld Misdaad Anoniem en bij ons — gebruik de meldknop op het profiel, of mail report@intimate.nl met zoveel mogelijk details, inclusief de locatie.' },
      { note: 'Contact met een minderjarige, of iemand die onder dwang of bedreiging werkt: stop direct, neem contact op met de klantenservice en stuur het bericht door naar report@intimate.nl. Bij bewezen criminele activiteiten dragen we gegevens over aan de autoriteiten.' },
      { h: 'Voor sekswerkers' },
      { p: 'Als sekswerker kun je je gratis laten inenten tegen hepatitis B bij de GGD. Combineer vaccinatie met condooms — die basis werkt.' },
    ],
  },
  'profile-rules': {
    title: 'Profielregels',
    description: 'Respect, eerlijkheid en leeftijdseisen — de regels die elk profiel op Intimate volgt.',
    body: [
      { h: 'Respecteer elkaar' },
      { p: 'De basis van Intimate is wederzijds respect. Discriminatie, haatzaaien, intimidatie en onbeschoftheid worden niet getolereerd — geen waarschuwingen, geen grijs gebied.' },
      { h: 'Wees jezelf' },
      { p: 'Presenteer jezelf eerlijk. Deel alleen je eigen foto’s en video’s, nooit anderen in beeld zonder toestemming, en geen materiaal dat auteursrechten schendt.' },
      { h: 'Leeftijd' },
      { list: [
        'Minimaal 18 jaar om het platform te gebruiken.',
        'Minimaal 21 jaar om te adverteren.',
        'Profielen die minderjarigheid suggereren kunnen verificatie vereisen.',
      ] },
      { h: 'Foto’s' },
      { p: 'Erotische foto’s zijn toegestaan; volledige naaktheid niet — geslachtsdelen en tepels blijven bedekt. Alleen jezelf in beeld, geen ongeautoriseerde merken of logo’s, geen tekst of contactgegevens.' },
      { p: 'Niet toegestaan: geweld verheerlijkende afbeeldingen, expliciete seksuele handelingen, of schokkend materiaal.' },
      { h: 'Handhaving' },
      { p: 'We hanteren een nultolerantiebeleid tegen illegaal gedrag: waarschuwingen, accountblokkades, profielverwijdering, of melding bij de autoriteiten.' },
    ],
  },
  verification: {
    title: 'Verificatieprocedure',
    description: 'Hoe adverteerderverificatie werkt, wat je aanlevert, en hoe we je documenten veilig houden.',
    body: [
      { h: 'Waarom we verifiëren' },
      { p: 'We controleren of adverteerders echt zijn, minimaal 21 jaar, en aan de richtlijnen voldoen — een veilige, betrouwbare omgeving voor iedereen. Wat je aanlevert blijft vertrouwelijk en verschijnt niet op je advertentie.' },
      { h: 'Voor je begint: maak een veilige kopie' },
      { p: 'Maak gevoelige gegevens op je identiteitsbewijs onleesbaar. We raden de KopieID-tool van de Rijksoverheid aan om onder andere je burgerservicenummer (BSN) af te schermen.' },
      { h: 'Wat je aanlevert' },
      { list: [
        'Identiteitsbewijs — pasfoto, geboortedatum, geldigheid en documentnummer zichtbaar.',
        'Selfie met ID — je gezicht en de pasfoto op het document duidelijk zichtbaar.',
        'Bewijs van aanwezigheid — een foto met een Nederlandse/Belgische krant of kassabon (niet ouder dan een week).',
        'Volledige foto — een heldere, onbewerkte afbeelding tot minimaal je middel.',
      ] },
      { h: 'Wat er daarna gebeurt' },
      { p: 'Ons moderatieteam beoordeelt inzendingen zo snel mogelijk. Na goedkeuring ontvang je een verificatievinkje, wat vertrouwen wekt en je zichtbaarheid vergroot.' },
      { h: 'Privacy en veiligheid' },
      { note: 'Verificatiedocumenten zijn versleuteld, worden in de EU opgeslagen, zijn alleen toegankelijk voor beoordelaars, elke toegang wordt gelogd, en de originelen worden na de bewaartermijn automatisch verwijderd. Ze worden uitsluitend voor verificatie gebruikt — nooit op je profiel getoond.' },
    ],
  },
  terms: {
    title: 'Algemene voorwaarden',
    description: 'De voorwaarden voor het gebruik van Intimate.',
    body: [
      { h: 'Introductie' },
      { p: 'Deze voorwaarden gelden voor alle bezoekers en gebruikers van Intimate. Door het platform te gebruiken, accepteer je ze.' },
      { h: 'De dienst' },
      { p: 'Intimate verbindt gebruikers via profielen met adult content. Wij zijn een advertentieplatform — we faciliteren of bemiddelen geen ontmoetingen en geven geen garanties over gebruikersgedrag.' },
      { h: 'Leeftijdsvereisten' },
      { list: ['Minimumleeftijd om het platform te gebruiken: 18 jaar.', 'Minimumleeftijd om te adverteren: 21 jaar.'] },
      { h: 'Gedrag' },
      { p: 'Verboden: bedreiging van gebruikers, onwettige content, schending van intellectuele eigendom, volledig naakt beeldmateriaal, delen van persoonlijke gegevens van anderen, en misbruik van accountgegevens.' },
      { h: 'Nultolerantie' },
      { p: 'We treden hard op tegen illegale prostitutie, dwang, chantage en elke betrokkenheid van minderjarigen. Meld verdachte activiteiten direct aan ons of de autoriteiten.' },
      { h: 'Aansprakelijkheid' },
      { p: 'Gebruik van het platform is voor eigen risico. Intimate accepteert geen aansprakelijkheid voor gebruikersgedrag, contact tussen leden, of technische storingen.' },
      { h: 'Toepasselijk recht' },
      { p: 'Nederlands recht is van toepassing; geschillen vallen onder de bevoegde Nederlandse rechter.' },
    ],
  },
  privacy: {
    title: 'Privacy & cookies',
    description: 'Hoe Intimate met je gegevens omgaat, je AVG-rechten, en onze cookievrije analyses.',
    body: [
      { h: 'Basisprincipes' },
      { p: 'We zijn AVG-minimaal: we verzamelen alleen wat een functie nodig heeft en bewaren het alleen zolang nodig. We verkopen je gegevens niet en delen ze niet met adverteerders.' },
      { h: 'Verwerkte gegevens' },
      { list: [
        'Bij registratie: e-mail (of telefoon) en IP, om je account aan te maken en te beveiligen.',
        'Bij profielbeheer: wat je zelf verstrekt. Profielinhoud is zichtbaar voor andere gebruikers.',
        'Bij verificatie (adverteerders): identiteitsdocumenten, behandeld zoals hieronder.',
      ] },
      { h: 'Verificatiedocumenten' },
      { p: 'Versleuteld, opgeslagen in de EU, alleen toegankelijk voor beoordelaars met logging van elke toegang, en na de bewaartermijn automatisch verwijderd. Ze verschijnen nooit op je profiel.' },
      { h: 'Cookies & analyses' },
      { p: 'Geen advertentie- of cross-site trackingcookies. We gebruiken privacyvriendelijke productanalyses om geaggregeerd gebruik te begrijpen; session replay staat permanent uit op bezoeker- en klantoppervlakken. Alleen functionele gegevens (inloggen, taal, leeftijdscheck, beveiliging) worden zonder toestemming bewaard, zoals de wet toestaat.' },
      { h: 'Jouw rechten (AVG)' },
      { p: 'Inzage, correctie, verwijdering, beperking, bezwaar, overdraagbaarheid en intrekking van toestemming. Mail privacy@intimate.nl; we reageren binnen één maand. Je kunt ook een klacht indienen bij de Autoriteit Persoonsgegevens.' },
    ],
  },
  app: {
    title: 'Download de Intimate-app',
    description: 'De volledige Intimate-ervaring op je telefoon — sneller, met meldingen, in enkele seconden geïnstalleerd.',
    body: [
      { h: 'Alles wat je kent, nu in je zak' },
      { p: 'Website of app, je geniet van dezelfde volledige Intimate-ervaring: direct chatten, video- en audiogesprekken, advertenties plaatsen en bekijken, en je tijdlijn met updates.' },
      { h: 'Waarom installeren?' },
      { list: [
        'Altijd toegang — geoptimaliseerd voor mobiel, waardoor alles sneller opent en natuurlijker aanvoelt dan een browsertab.',
        'Je mist niks meer — ontvang een melding zodra er een nieuw bericht, reactie of match binnenkomt.',
        'Privacy ingebouwd — moderne beveiliging die je persoonlijke gegevens beschermt.',
      ] },
      { h: 'Installeer in enkele seconden' },
      { p: 'Open Intimate in de browser van je telefoon en gebruik “Toevoegen aan startscherm” in het deelmenu. Intimate staat dan als app op je toestel, klaar voor gebruik — geen appstore nodig.' },
    ],
  },
};

const de: Record<PageSlug, PageContent> = {
  about: {
    title: 'Über Intimate',
    description: 'Eine Plattform nur mit verifizierten Profilen für sichere, schnelle und echte Kontakte in den Niederlanden.',
    body: [
      { p: 'Intimate ist eine Plattform für sichere, dynamische Online-Kontakte — moderne Technologie, Geschwindigkeit und Gemeinschaft an einem Ort.' },
      { h: 'Unsere Mission' },
      { p: 'Wir stellen Sicherheit, Geschwindigkeit und echte menschliche Interaktion voran: Authentizität und Privatsphäre in einer echten Gemeinschaft, keine anonyme Masse.' },
      { h: 'Sicherheit zuerst' },
      { list: [
        'Nur verifiziert — jede*r Inserent*in durchläuft eine gründliche Verifizierung, bevor das Profil live geht.',
        'Aktive Moderation — unser Team beobachtet die Gemeinschaft und reagiert schnell auf Meldungen.',
      ] },
      { h: 'Geschwindigkeit und Technologie' },
      { p: 'Die Plattform fühlt sich direkt an — Profil verwalten, Anzeigen durchsuchen und Updates posten lässt dich nie warten.' },
      { h: 'Inklusiv als Standard' },
      { p: 'Intimate ist für alle da. Professionals, die LGBTQ+-Gemeinschaft und alle anderen sind ausdrücklich willkommen, ohne Urteil über die gesuchten Kontakte.' },
    ],
  },
  safety: {
    title: 'Sicherheit & Bewusstsein',
    description: 'Worauf du achten solltest, wann du gehen solltest und wie du Missbrauch meldest. Deine Sicherheit steht an erster Stelle.',
    body: [
      { p: 'Deine Sicherheit steht an erster Stelle, und deine Aufmerksamkeit macht wirklich einen Unterschied. Hier liest du, worauf du achten solltest, wann du gehen solltest und wie du Missbrauch meldest.' },
      { h: 'Vor deinem Termin' },
      { p: 'Unsicher über das Alter einer Person? Verlange einen Ausweis. Bekommst du keine Klarheit oder bleibt der Zweifel, dann geh — du schuldest niemandem eine Erklärung.' },
      { p: 'Vertraue deinem Gefühl. Wenn sich etwas falsch anfühlt, ist es das meistens. Klingt etwas zu schön, um wahr zu sein, ist es das meistens auch.' },
      { h: 'Wann du sofort gehen solltest' },
      { list: [
        'Der Ort ist unhygienisch oder unsicher (ein Keller, ein Schuppen).',
        'Minderjährige sind anwesend.',
        'Du fühlst dich aus irgendeinem Grund unsicher.',
      ] },
      { p: 'Du brauchst keinen Beweis und keinen guten Grund. Ein ungutes Gefühl genügt.' },
      { h: 'Missbrauch melden' },
      { p: 'Melde Missbrauch bei der Polizei, bei Meld Misdaad Anoniem (anonyme Kriminalitätsmeldung) und bei uns — nutze die Melden-Schaltfläche im Profil oder schreibe an report@intimate.nl mit möglichst vielen Details, auch dem Ort.' },
      { note: 'Kontakt mit einer minderjährigen Person oder mit jemandem, der unter Zwang oder Bedrohung arbeitet: sofort abbrechen, den Support kontaktieren und die Nachricht an report@intimate.nl weiterleiten. Bei nachgewiesenen Straftaten geben wir Daten an die Behörden weiter.' },
      { h: 'Für Sexarbeiter*innen' },
      { p: 'Als Sexarbeiter*in kannst du dich beim GGD kostenlos gegen Hepatitis B impfen lassen. Kombiniere die Impfung mit Kondomen — diese Basis funktioniert.' },
    ],
  },
  'profile-rules': {
    title: 'Profilregeln',
    description: 'Respekt, Ehrlichkeit und Altersvorgaben — die Regeln, denen jedes Profil auf Intimate folgt.',
    body: [
      { h: 'Respektiert einander' },
      { p: 'Die Basis von Intimate ist gegenseitiger Respekt. Diskriminierung, Hassrede, Einschüchterung und Unhöflichkeit werden nicht geduldet — keine Warnungen, keine Grauzone.' },
      { h: 'Sei du selbst' },
      { p: 'Präsentiere dich ehrlich. Teile nur deine eigenen Fotos und Videos, niemals andere ohne deren Zustimmung im Bild, und nichts, das Urheberrechte verletzt.' },
      { h: 'Alter' },
      { list: [
        'Mindestens 18 Jahre, um die Plattform zu nutzen.',
        'Mindestens 21 Jahre, um zu inserieren.',
        'Profile, die Minderjährigkeit nahelegen, können eine Verifizierung erfordern.',
      ] },
      { h: 'Fotos' },
      { p: 'Erotische Fotos sind erlaubt; vollständige Nacktheit nicht — Genitalien und Brustwarzen bleiben bedeckt. Nur du selbst im Bild, keine unautorisierten Marken oder Logos, kein Text oder Kontaktdaten.' },
      { p: 'Nicht erlaubt: Gewalt verherrlichende Bilder, explizite sexuelle Handlungen oder schockierendes Material.' },
      { h: 'Durchsetzung' },
      { p: 'Wir verfolgen eine Null-Toleranz-Politik gegen illegales Verhalten: Warnungen, Kontosperren, Profilentfernung oder Meldung an die Behörden.' },
    ],
  },
  verification: {
    title: 'Verifizierungsverfahren',
    description: 'Wie die Verifizierung von Inserent*innen funktioniert, was einzureichen ist und wie wir deine Dokumente schützen.',
    body: [
      { h: 'Warum wir verifizieren' },
      { p: 'Wir prüfen, dass Inserent*innen echt sind, mindestens 21 Jahre alt sind und die Richtlinien erfüllen — eine sichere, vertrauenswürdige Umgebung für alle. Was du einreichst, bleibt vertraulich und erscheint nie in deiner Anzeige.' },
      { h: 'Bevor du beginnst: mach eine sichere Kopie' },
      { p: 'Mache sensible Daten auf deinem Ausweis unkenntlich. Wir empfehlen das KopieID-Tool der niederländischen Regierung, um etwa deine Bürgerservicenummer (BSN) zu schwärzen.' },
      { h: 'Was du einreichst' },
      { list: [
        'Ausweisdokument — Foto, Geburtsdatum, Gültigkeit und Dokumentnummer sichtbar.',
        'Selfie mit Ausweis — dein Gesicht und das Foto auf dem Dokument klar sichtbar.',
        'Anwesenheitsnachweis — ein Foto mit einer niederländischen/belgischen Zeitung oder einem Kassenbon, nicht älter als eine Woche.',
        'Ganzkörperfoto — ein klares, unbearbeitetes Bild, das dich mindestens bis zur Taille zeigt.',
      ] },
      { h: 'Was danach passiert' },
      { p: 'Unser Moderationsteam prüft Einsendungen so schnell wie möglich. Nach der Freigabe erhältst du ein Verifizierungshäkchen, das Vertrauen schafft und deine Sichtbarkeit erhöht.' },
      { h: 'Privatsphäre und Sicherheit' },
      { note: 'Verifizierungsdokumente sind verschlüsselt, werden in der EU gespeichert, sind nur für Prüfende zugänglich, jeder Zugriff wird protokolliert, und die Originale werden nach der Aufbewahrungsfrist automatisch gelöscht. Sie werden ausschließlich zur Verifizierung verwendet — nie in deinem Profil gezeigt.' },
    ],
  },
  terms: {
    title: 'Allgemeine Geschäftsbedingungen',
    description: 'Die Bedingungen für die Nutzung von Intimate. Maßgeblich ist die niederländische Fassung.',
    body: [
      { note: 'Dies ist eine Zusammenfassung in einfacher Sprache. Maßgeblich ist die niederländische Fassung.' },
      { h: 'Einleitung' },
      { p: 'Diese Bedingungen gelten für alle Besucher*innen und Nutzer*innen von Intimate. Durch die Nutzung der Plattform akzeptierst du sie.' },
      { h: 'Der Dienst' },
      { p: 'Intimate verbindet Nutzer*innen über Profile mit Inhalten für Erwachsene. Wir sind eine Anzeigenplattform — wir vermitteln keine Treffen und geben keine Garantien über das Verhalten von Nutzer*innen.' },
      { h: 'Altersanforderungen' },
      { list: ['Mindestalter zur Nutzung der Plattform: 18 Jahre.', 'Mindestalter zum Inserieren: 21 Jahre.'] },
      { h: 'Verhalten' },
      { p: 'Verboten: Bedrohung von Nutzer*innen, rechtswidrige Inhalte, Verletzung geistigen Eigentums, vollständig nacktes Bildmaterial, das Teilen persönlicher Daten anderer und der Missbrauch von Kontodaten.' },
      { h: 'Null Toleranz' },
      { p: 'Wir gehen entschieden gegen illegale Prostitution, Zwang, Erpressung und jede Beteiligung Minderjähriger vor. Melde verdächtige Aktivitäten sofort uns oder den Behörden.' },
      { h: 'Haftung' },
      { p: 'Die Nutzung der Plattform erfolgt auf eigenes Risiko. Intimate übernimmt keine Haftung für das Verhalten von Nutzer*innen, Kontakte zwischen Mitgliedern oder technische Störungen.' },
      { h: 'Anwendbares Recht' },
      { p: 'Es gilt niederländisches Recht; Streitigkeiten unterliegen dem zuständigen niederländischen Gericht.' },
    ],
  },
  privacy: {
    title: 'Datenschutz & Cookies',
    description: 'Wie Intimate mit deinen Daten umgeht, deine DSGVO-Rechte und unsere cookiefreie Analyse.',
    body: [
      { h: 'Grundprinzipien' },
      { p: 'Wir sind DSGVO-minimal: Wir erheben nur, was eine Funktion braucht, und behalten es nur so lange wie nötig. Wir verkaufen deine Daten nicht und teilen sie nicht mit Werbetreibenden.' },
      { h: 'Verarbeitete Daten' },
      { list: [
        'Bei der Registrierung: E-Mail (oder Telefon) und IP, um dein Konto zu erstellen und zu sichern.',
        'Bei der Profilverwaltung: was du selbst angibst. Profilinhalte sind für andere Nutzer*innen sichtbar.',
        'Bei der Verifizierung (Inserent*innen): Ausweisdokumente, behandelt wie unten beschrieben.',
      ] },
      { h: 'Verifizierungsdokumente' },
      { p: 'Verschlüsselt, in der EU gespeichert, nur für Prüfende zugänglich mit Protokollierung jedes Zugriffs, und nach der Aufbewahrungsfrist automatisch gelöscht. Sie erscheinen nie in deinem Profil.' },
      { h: 'Cookies & Analyse' },
      { p: 'Keine Werbe- oder Cross-Site-Tracking-Cookies. Wir nutzen datenschutzfreundliche Produktanalyse, um die aggregierte Nutzung zu verstehen; Session Replay ist auf Besucher- und Kundenoberflächen dauerhaft aus. Nur funktionale Daten (Login, Sprache, Alterscheck, Sicherheit) werden ohne Einwilligung gespeichert, wie es das Gesetz erlaubt.' },
      { h: 'Deine Rechte (DSGVO)' },
      { p: 'Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch, Übertragbarkeit und Widerruf der Einwilligung. Schreibe an privacy@intimate.nl; wir antworten innerhalb eines Monats. Du kannst dich auch bei der Autoriteit Persoonsgegevens beschweren.' },
    ],
  },
  app: {
    title: 'Hol dir die Intimate-App',
    description: 'Die volle Intimate-Erfahrung auf deinem Handy — schneller, mit Benachrichtigungen, in Sekunden installiert.',
    body: [
      { h: 'Alles, was du kennst, jetzt in deiner Tasche' },
      { p: 'Website oder App, du bekommst dieselbe vollständige Intimate-Erfahrung: sofortiger Chat, Video- und Audioanrufe, Anzeigen zum Posten und Durchsuchen und deine Timeline mit Updates.' },
      { h: 'Warum installieren?' },
      { list: [
        'Überall Zugriff — für Mobilgeräte optimiert, sodass alles schneller öffnet und natürlicher wirkt als ein Browser-Tab.',
        'Verpasse nichts — erhalte eine Benachrichtigung, sobald eine neue Nachricht, Antwort oder ein Match ankommt.',
        'Privatsphäre eingebaut — moderne Sicherheit schützt deine persönlichen Daten.',
      ] },
      { h: 'In Sekunden installieren' },
      { p: 'Öffne Intimate im Browser deines Handys und nutze „Zum Startbildschirm hinzufügen“ im Teilen-Menü. Intimate liegt dann als App auf deinem Gerät, bereit zur Nutzung — kein App-Store nötig.' },
    ],
  },
};

const BY_LOCALE: Partial<Record<Locale, Record<PageSlug, PageContent>>> = { en, nl, de };

export const PAGE_SLUGS = Object.keys(en) as PageSlug[];

/** Page content for a slug in a locale, falling back to English. */
export function sitePage(slug: PageSlug, locale: Locale): PageContent {
  return (BY_LOCALE[locale] ?? en)[slug] ?? en[slug];
}
