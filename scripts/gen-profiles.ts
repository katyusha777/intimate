/**
 * Regenerate the dummy dataset: one profile per NSFW image (30), valid against
 * taxonomy, deterministic. Run: bun scripts/gen-profiles.ts
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { ALL_SERVICES, CITIES, GENDERS, SERVICES } from '../src/lib/taxonomy';

const nsfw = readdirSync('public/nsfwimg')
  .filter((f) => !f.startsWith('.'))
  .sort()
  .map((f) => `/nsfwimg/${f}`);

const NAMES = [
  'Eva', 'Mila', 'Sophie', 'Zara', 'Jade', 'Femke', 'Isa', 'Noa', 'Yasmin', 'Lena',
  'Kim', 'Anouk', 'Luna', 'Bo', 'Sara', 'Julia', 'Nina', 'Romy', 'Elif', 'Amber',
  'Daan', 'Max', 'Valentina', 'Bibi', 'Chantal', 'Esmee', 'Lot', 'Vera', 'Iris', 'Tess',
];

// weighted gender spread: mostly women, a few men / trans women / trans men
const GENDER_PLAN = [
  0, 0, 0, 0, 2, 0, 0, 0, 0, 0,
  0, 0, 3, 1, 0, 0, 0, 0, 2, 0,
  1, 1, 2, 0, 0, 0, 0, 0, 0, 0,
] as const;

const SERVICE_POOL = [
  ...SERVICES.companionship,
  ...SERVICES.massage,
  ...SERVICES.intimacy,
  ...SERVICES.oral,
];
const VIRTUAL = SERVICES.virtual;

const DESC: [string, string, string][] = [
  [
    'Warm, discreet and attentive — I love real connection and taking our time.',
    'Warm, discreet en attent — ik hou van echte connectie en de tijd nemen.',
    'Warm, diskret und aufmerksam — ich liebe echte Verbindung und nehme mir Zeit.',
  ],
  [
    'Playful and open-minded. Expect genuine chemistry and zero rush.',
    'Speels en ruimdenkend. Verwacht echte chemie en geen haast.',
    'Verspielt und aufgeschlossen. Erwarte echte Chemie und keine Eile.',
  ],
  [
    'Elegant company for dinners, travel and everything after.',
    'Elegant gezelschap voor diners, reizen en alles daarna.',
    'Elegante Begleitung für Dinner, Reisen und alles danach.',
  ],
  [
    'Certified masseuse with a naughty side — relaxing has never felt this good.',
    'Gediplomeerd masseuse met een ondeugende kant — ontspannen was nog nooit zo fijn.',
    'Ausgebildete Masseurin mit frecher Seite — Entspannung war nie schöner.',
  ],
];

function pick<T>(arr: readonly T[], seed: number, count: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(arr[(seed * 7 + i * 13) % arr.length]!);
  return [...new Set(out)];
}

const profiles = nsfw.map((img, i) => {
  const n = i + 1;
  const id = `p${String(n).padStart(2, '0')}`;
  const name = NAMES[i]!;
  // every city gets at least one profile (30 profiles ≥ city count)
  const city = CITIES[i % CITIES.length]!.slug;
  const gender = GENDERS[GENDER_PLAN[i]!]!;
  const virtual = i % 7 === 3; // a few offer virtual services (delivery = derived)
  // coverage chunk: service j belongs to profile (j % 30) → EVERY service has
  // at least one profile; extras on top for variety.
  const chunk = ALL_SERVICES.filter((_, j) => j % nsfw.length === i);
  const services = [
    ...new Set([
      ...chunk,
      ...pick(SERVICE_POOL, i, 2 + (i % 2)),
      ...(virtual ? pick(VIRTUAL, i, 2) : []),
    ]),
  ];
  const meetingTypes = i % 5 === 0 ? ['incall'] : i % 5 === 2 ? ['outcall'] : ['incall', 'outcall'];
  const d = DESC[i % DESC.length]!;
  const created = new Date(Date.UTC(2026, 5, 1 + ((i * 61) % 55), 8 + (i % 10))).toISOString();

  return {
    id,
    slug: `${name.toLowerCase()}-${city}`,
    state: 'live',
    name,
    age: 21 + ((i * 7) % 15),
    gender,
    city,
    verified: true, // every profile on Intimate is verified
    online: i % 3 === 0,
    featured: i < 5,
    priceFrom: 100 + ((i * 37) % 18) * 10,
    services,
    meetingTypes,
    description: d[0],
    descriptionTranslations: { en: d[0], nl: d[1], de: d[2] },
    photos: [img, nsfw[(i + 7) % nsfw.length]!, nsfw[(i + 15) % nsfw.length]!],
    createdAt: created,
  };
});

writeFileSync('src/app/data/json/profiles.json', JSON.stringify(profiles, null, 2) + '\n');
console.log(`wrote ${profiles.length} profiles`);
