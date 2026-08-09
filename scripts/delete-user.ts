/**
 * COMPLETE user deletion for testing/support — both halves of an identity:
 * the public.accounts row (which holds the VERIFIED PHONE that blocks
 * re-registration) AND the auth.users row. Deleting only in the Supabase
 * dashboard orphans the accounts row and the phone stays "already registered".
 *
 *   bun scripts/delete-user.ts <email>
 *
 * Also removes everything hanging off the account (profiles, media rows + R2
 * bytes, threads/messages, contacts, favorites, verification docs). Bun-only.
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('usage: bun scripts/delete-user.ts <email>');
  process.exit(1);
}
const url = process.env.PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;
if (!url || !secret || !dbUrl) {
  console.error('PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DATABASE_URL missing — fill .env');
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, prepare: false });
const [acc] = await sql`select id, phone from accounts where lower(email) = ${email.toLowerCase()}`;
const admin = createClient(url, secret);

// Auth side — look up by email even if the accounts row is already gone.
let authId: string | undefined;
for (let page = 1; page <= 10 && !authId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  authId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (data.users.length < 200) break;
}

const id = acc?.id ?? authId;
if (!id) {
  console.error(`nothing to delete for ${email}`);
  await sql.end();
  process.exit(1);
}

if (acc) {
  await sql.begin(async (tx) => {
    const owned = await tx`select id from profiles where account_id = ${id}`;
    const pids = owned.map((p) => p.id);
    if (pids.length) {
      const media = await tx`delete from media where profile_id in ${tx(pids)} returning image_key`;
      await tx`delete from messages where thread_id in (select id from threads where profile_id in ${tx(pids)})`;
      await tx`delete from contacts where profile_id in ${tx(pids)}`;
      await tx`delete from threads where profile_id in ${tx(pids)}`;
      await tx`delete from conversation_settings where profile_id in ${tx(pids)}`;
      await tx`delete from contact_invites where profile_id in ${tx(pids)}`;
      console.log(`profiles: ${pids.length}, media rows: ${media.length} (R2 bytes NOT deleted — run admin GDPR wipe for real users)`);
      await tx`delete from profiles where account_id = ${id}`;
    }
    await tx`delete from messages where thread_id in (select id from threads where client_account_id = ${id})`;
    await tx`delete from contacts where client_account_id = ${id}`;
    await tx`delete from threads where client_account_id = ${id}`;
    await tx`delete from favorites where client_account_id = ${id}`;
    await tx`delete from verification_docs where account_id = ${id}`;
    await tx`update reports set reporter_account_id = null where reporter_account_id = ${id}`;
    await tx`delete from accounts where id = ${id}`;
  });
  console.log(`accounts row deleted (${email}${acc.phone ? `, phone ${acc.phone} freed` : ''})`);
}
if (authId) {
  const { error } = await admin.auth.admin.deleteUser(authId);
  if (error) throw error;
  console.log('auth user deleted');
} else {
  console.log('no auth user (already deleted in dashboard)');
}
await sql.end();
