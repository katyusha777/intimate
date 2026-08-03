/**
 * Promote an existing auth user to admin (ADMIN.md §1). Role escalation is a
 * server-side operation — never part of signup. Bun-only script.
 *
 *   bun scripts/make-admin.ts <email> [moderator|support|super]   (default super)
 *
 * Sets app_metadata { account_type: 'admin', admin_role } (the JWT claim the
 * admin gate reads — takes effect on next token refresh/login) and mirrors it
 * onto the accounts row.
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const [email, role = 'super'] = process.argv.slice(2);
if (!email || !['moderator', 'support', 'super'].includes(role)) {
  console.error('usage: bun scripts/make-admin.ts <email> [moderator|support|super]');
  process.exit(1);
}
const url = process.env.PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;
if (!url || !secret || !dbUrl) {
  console.error('PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DATABASE_URL missing — fill .env');
  process.exit(1);
}

const admin = createClient(url, secret);
// Look the user up by email (paged scan is fine at this scale).
let userId: string | undefined;
for (let page = 1; page <= 10 && !userId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (data.users.length < 200) break;
}
if (!userId) {
  console.error(`no auth user with email ${email} — register in the app first`);
  process.exit(1);
}

const { error } = await admin.auth.admin.updateUserById(userId, {
  app_metadata: { account_type: 'admin', admin_role: role },
});
if (error) throw error;

const sql = postgres(dbUrl, { max: 1, prepare: false });
await sql`update accounts set account_type = 'admin', admin_role = ${role} where id = ${userId}`;
await sql.end();

console.log(`${email} → admin (${role}). Takes effect on their next sign-in/token refresh.`);
