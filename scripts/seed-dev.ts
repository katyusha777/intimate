/**
 * Dev/staging seed: loads the 30 mock profiles (src/app/data/json/profiles.json)
 * into Postgres — accounts + profiles + media — so the db backend serves the
 * exact catalog the json backend does (tests/db-parity.test.ts asserts it).
 *
 * Deterministic UUIDs → idempotent: re-running replaces the previous seed.
 * Mock `online: true` becomes a fresh last_active_at heartbeat (the db's online
 * signal); photo/privatePhoto URLs land in media.image_key and pass through
 * the projection unchanged (Cloudflare Images keys arrive with the real
 * upload flow). Bun-only script — never imported from src/.
 *
 *   bun run db:seed          # uses DATABASE_URL from .env
 */
import { z } from 'zod';
import postgres from 'postgres';
import { ProfileSchema } from '../src/app/models/profile';
import raw from '../src/app/data/json/profiles.json';

const uuid = (nibble: string, i: number) =>
  `00000000-0000-4000-${nibble}000-${String(i + 1).padStart(12, '0')}`;
export const seedAccountId = (i: number) => uuid('a', i);
export const seedProfileId = (i: number) => uuid('b', i);

export async function seed(url: string): Promise<number> {
  const sql = postgres(url, { max: 1, prepare: false });
  const all = z.array(ProfileSchema).parse(raw);
  const now = new Date();

  try {
    await sql.begin(async (tx) => {
      // Replace any previous seed (children first — FKs are NO ACTION).
      await tx`delete from media where profile_id in (select id from profiles where account_id in (select id from accounts where email like '%@seed.local'))`;
      await tx`delete from profiles where account_id in (select id from accounts where email like '%@seed.local')`;
      await tx`delete from accounts where email like '%@seed.local'`;

      for (const [i, p] of all.entries()) {
        await tx`insert into accounts (id, account_type, email, display_name, phone) values
          (${seedAccountId(i)}, 'advertiser', ${`${p.slug}@seed.local`}, ${p.name}, ${p.phone ?? null})`;
        await tx`insert into profiles ${tx({
          id: seedProfileId(i),
          account_id: seedAccountId(i),
          slug: p.slug,
          state: p.state,
          name: p.name,
          birth_date: p.birthDate,
          gender: p.gender,
          city: p.city,
          verified: p.verified,
          id_verified_at: p.idVerifiedAt ?? null,
          photo_verified_at: p.photoVerifiedAt ?? null,
          featured: p.featured,
          // online flag → heartbeat; offline keeps the (stale) mock timestamp.
          last_active_at: p.online ? now : (p.lastActiveAt ?? null),
          price_from: p.priceFrom,
          rates: JSON.stringify(p.rates),
          phone: p.phone ?? null,
          deposit_policy: p.depositPolicy ?? null,
          extras_note: p.extrasNote ?? null,
          services: p.services,
          meeting_types: p.meetingTypes,
          languages: p.languages,
          incall_locations: p.incallLocations,
          amenities: p.amenities,
          payment_methods: p.paymentMethods,
          available_for: p.availableFor,
          opening_hours: JSON.stringify(p.openingHours),
          description: p.description,
          description_translations: JSON.stringify(p.descriptionTranslations),
          created_at: p.createdAt,
        })}`;
        const rows = [
          ...p.photos.map((key, pos) => ({ isPrivate: false, key, pos })),
          ...p.privatePhotos.map((key, pos) => ({ isPrivate: true, key, pos })),
        ];
        for (const m of rows) {
          await tx`insert into media (profile_id, state, image_key, is_private, position) values
            (${seedProfileId(i)}, 'approved', ${m.key}, ${m.isPrivate}, ${m.pos})`;
        }
      }
    });
    return all.length;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set — copy .env.example to .env and fill it in');
    process.exit(1);
  }
  const n = await seed(url);
  console.log(`seeded ${n} profiles into ${new URL(url).host}`);
}
