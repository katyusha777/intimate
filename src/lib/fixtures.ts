/**
 * Dummy profile data for building/testing the UI before the real schema exists.
 * Shape is UI-facing only — NOT a schema draft. Values come from taxonomy.
 * "Photos" reuse safeimg files since no real media exists yet.
 */
import type { CitySlug, Gender, Service } from './taxonomy';
import { SAFE_IMAGES } from './safe-images';

export interface FixtureProfile {
  id: string;
  slug: string;
  name: string;
  age: number;
  city: CitySlug;
  gender: Gender;
  verified: boolean;
  online: boolean;
  featured?: boolean;
  priceFrom: number; // EUR, lowest rate
  services: Service[];
  tagline: string;
  photos: string[];
}

const img = (i: number) => SAFE_IMAGES[i % SAFE_IMAGES.length]!;

const photos = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => img(start + i));

export const PROFILES: FixtureProfile[] = [
  {
    id: 'p01', slug: 'eva-amsterdam', name: 'Eva', age: 26, city: 'amsterdam',
    gender: 'female', verified: true, online: true, featured: true, priceFrom: 150,
    services: ['girlfriend_experience', 'dinner_date', 'french_kissing'],
    tagline: 'Warm, speels en discreet — centrum Amsterdam.',
    photos: photos(0, 5),
  },
  {
    id: 'p02', slug: 'sophie-amsterdam', name: 'Sophie', age: 29, city: 'amsterdam',
    gender: 'female', verified: true, online: false, featured: true, priceFrom: 200,
    services: ['erotic_massage', 'body_to_body_massage', 'tantra_massage'],
    tagline: 'Massage-specialist, eigen studio in Zuid.',
    photos: photos(5, 4),
  },
  {
    id: 'p03', slug: 'lena-rotterdam', name: 'Lena', age: 24, city: 'rotterdam',
    gender: 'female', verified: true, online: true, priceFrom: 130,
    services: ['girlfriend_experience', 'striptease', 'kissing'],
    tagline: 'Spontaan en energiek, avonden & weekenden.',
    photos: photos(9, 4),
  },
  {
    id: 'p04', slug: 'yasmin-den-haag', name: 'Yasmin', age: 31, city: 'den-haag',
    gender: 'female', verified: true, online: true, priceFrom: 180,
    services: ['pornstar_experience', 'role_play', 'sex_toys'],
    tagline: 'Ervaren, open-minded, eigen appartement.',
    photos: photos(13, 5),
  },
  {
    id: 'p05', slug: 'noa-utrecht', name: 'Noa', age: 22, city: 'utrecht',
    gender: 'female', verified: false, online: false, priceFrom: 120,
    services: ['girlfriend_experience', 'shower_together'],
    tagline: 'Nieuw in Utrecht — lief en attent.',
    photos: photos(18, 3),
  },
  {
    id: 'p06', slug: 'mila-amsterdam', name: 'Mila', age: 27, city: 'amsterdam',
    gender: 'female', verified: true, online: false, featured: true, priceFrom: 250,
    services: ['dinner_date', 'travel_companion', 'overnight_stay'],
    tagline: 'High-class companion voor diners en reizen.',
    photos: photos(21, 6),
  },
  {
    id: 'p07', slug: 'kim-eindhoven', name: 'Kim', age: 25, city: 'eindhoven',
    gender: 'female', verified: true, online: true, priceFrom: 140,
    services: ['relaxing_massage', 'erotic_massage', 'nuru_massage'],
    tagline: 'Massagestudio bij Strijp-S, ook duo mogelijk.',
    photos: photos(27, 4),
  },
  {
    id: 'p08', slug: 'anouk-groningen', name: 'Anouk', age: 33, city: 'groningen',
    gender: 'female', verified: true, online: false, priceFrom: 160,
    services: ['domination', 'light_bdsm', 'role_play'],
    tagline: 'Strikt maar rechtvaardig — beginners welkom.',
    photos: photos(31, 4),
  },
  {
    id: 'p09', slug: 'isa-rotterdam', name: 'Isa', age: 28, city: 'rotterdam',
    gender: 'female', verified: false, online: true, priceFrom: 110,
    services: ['kissing', 'position_69', 'dirty_talk'],
    tagline: 'Gezellig en zonder haast, Kralingen.',
    photos: photos(35, 3),
  },
  {
    id: 'p10', slug: 'femke-utrecht', name: 'Femke', age: 30, city: 'utrecht',
    gender: 'female', verified: true, online: true, priceFrom: 170,
    services: ['girlfriend_experience', 'erotic_massage', 'french_kissing'],
    tagline: 'GFE met echte aandacht — centrum Utrecht.',
    photos: photos(2, 5),
  },
  {
    id: 'p11', slug: 'zara-den-haag', name: 'Zara', age: 23, city: 'den-haag',
    gender: 'trans_woman', verified: true, online: false, priceFrom: 145,
    services: ['striptease', 'erotic_dance', 'party_companion'],
    tagline: 'Danseres — boekbaar voor privé en events.',
    photos: photos(8, 4),
  },
  {
    id: 'p12', slug: 'jade-amsterdam', name: 'Jade', age: 35, city: 'amsterdam',
    gender: 'female', verified: true, online: true, priceFrom: 220,
    services: ['tantra_massage', 'prostate_massage', 'four_hands_massage'],
    tagline: 'Tantra-practitioner, sessies van 90+ min.',
    photos: photos(15, 5),
  },
];

export const FEATURED = PROFILES.filter((p) => p.featured);

export interface FixtureArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  minutes: number;
  featured?: boolean;
}

export const ARTICLES: FixtureArticle[] = [
  {
    id: 'a01',
    slug: 'ontdek-de-intimate-app',
    title: 'Ontdek de Intimate app: een nieuwe dimensie in erotisch plezier',
    excerpt:
      'De Intimate app brengt geverifieerde profielen, veilige chat en communityfuncties samen op één plek. Dit is wat je kunt verwachten.',
    minutes: 2,
    featured: true,
  },
  {
    id: 'a02',
    slug: 'verleidelijke-achtergronden',
    title: 'Verleidelijke achtergronden van Intimate.nl — gratis download!',
    excerpt: 'Een set wallpapers uit onze fotoshoots, vrij te gebruiken.',
    minutes: 1,
  },
  {
    id: 'a03',
    slug: 'starten-als-escort-in-nederland',
    title: 'Starten als escort in Nederland: richtlijnen, tips en ondersteuning',
    excerpt: 'Wat je moet weten voor je begint — wetgeving, veiligheid en verificatie.',
    minutes: 5,
  },
  {
    id: 'a04',
    slug: 'girlfriend-experience-gfe',
    title: 'De Girlfriend Experience (GFE): een diepere duik in intimiteit en connectie',
    excerpt: 'Waarom GFE de meest gevraagde ervaring is en wat het inhoudt.',
    minutes: 4,
  },
];
