/**
 * GDPR fulfilment (items.md #6/#7, ADMIN.md governance): users flag a request
 * from Settings; admins fulfil here.
 *
 *  · Export: every row we hold about the account, as one JSON object — the
 *    admin downloads it and mails it (no outbound email provider yet).
 *  · Deletion (approval IS the GDPR review): PII scrubbed from `accounts`
 *    (row survives skeletal for audit/defensibility — 0001 header decision),
 *    her profile soft-deleted (hard rule 6: no hard deletes), and the
 *    auth.users entry removed via the service-role Admin API when
 *    SUPABASE_SERVICE_ROLE_KEY is configured (the ONE sanctioned place —
 *    CLAUDE.md admin boundary rule 2).
 */
import { env } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import { eq, inArray, or } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { evictMediaCache, isR2Key, mediaBucket } from '@/lib/media-keys';
import {
  accounts,
  callSessions,
  contacts,
  favorites,
  media,
  messages,
  profiles,
  reports,
  threads,
} from '@/db/schema';

const adb = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

/** Service-role auth Admin API client — null when the secret isn't configured.
 *  The ONE sanctioned construction site (CLAUDE.md admin boundary rule 2). */
export function serviceAuthClient(): ReturnType<typeof createClient> | null {
  const e = env as unknown as Record<string, string | undefined>;
  const key = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(e.PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Everything we hold on one account, projected for the export file. */
export async function exportAccountData(accountId: string): Promise<Record<string, unknown>> {
  const d = adb();
  const [account] = await d.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return { error: 'account not found' };
  const owned = await d.select().from(profiles).where(eq(profiles.accountId, accountId));
  const profileIds = owned.map((p) => p.id);
  const threadRows = await d
    .select()
    .from(threads)
    .where(
      profileIds.length
        ? or(eq(threads.clientAccountId, accountId), inArray(threads.profileId, profileIds))
        : eq(threads.clientAccountId, accountId),
    );
  const threadIds = threadRows.map((t) => t.id);
  return {
    exportedAt: new Date().toISOString(),
    account,
    profiles: owned,
    media: profileIds.length ? await d.select().from(media).where(inArray(media.profileId, profileIds)) : [],
    threads: threadRows,
    messages: threadIds.length
      ? await d.select().from(messages).where(inArray(messages.threadId, threadIds))
      : [],
    contacts: profileIds.length
      ? await d.select().from(contacts).where(inArray(contacts.profileId, profileIds))
      : [],
    favorites: await d.select().from(favorites).where(eq(favorites.clientAccountId, accountId)),
    callSessions: threadIds.length
      ? await d.select().from(callSessions).where(inArray(callSessions.threadId, threadIds))
      : [],
    reports: await d.select().from(reports).where(eq(reports.reporterAccountId, accountId)),
  };
}

/** Building the export IS the fulfilment — clear the flag so the admin banner
 *  drops it instead of nagging forever. Returns the rows the write touched. */
export async function clearDataRequest(accountId: string): Promise<{ id: string }[]> {
  return adb()
    .update(accounts)
    .set({ dataRequestedAt: null })
    .where(eq(accounts.id, accountId))
    .returning({ id: accounts.id });
}

/**
 * Approve a deletion request. Returns whether the auth user was also removed
 * (false = the SUPABASE_SERVICE_ROLE_KEY secret isn't configured yet — the
 * scrub still happened; rerun after adding the secret to finish).
 */
export async function approveDeletion(accountId: string): Promise<{ authDeleted: boolean }> {
  const d = adb();
  // Soft-delete her profiles (lifecycle law — the 410/IndexNow flow reads state).
  await d.update(profiles).set({ state: 'deleted' }).where(eq(profiles.accountId, accountId));
  // Purge her photo BYTES from R2 — a GPS/identity leak must not survive a
  // takedown at previously-known URLs (scrapers hold them). Verification docs
  // are toxic-waste with a legal retention window → left to the purge cron,
  // NOT deleted here (hard rule 3).
  const owned = await d.select({ id: profiles.id }).from(profiles).where(eq(profiles.accountId, accountId));
  if (owned.length) {
    const removed = await d
      .delete(media)
      .where(inArray(media.profileId, owned.map((p) => p.id)))
      .returning({ key: media.imageKey });
    const b = mediaBucket();
    await Promise.allSettled(removed.filter((r) => isR2Key(r.key)).map((r) => b.delete(r.key)));
    // The deleted media rows make /media 410 before its edge-cache lookup —
    // but that gate read can lag writes (Hyperdrive), so evict the edge
    // copies too: identity photos must not outlive a GDPR wipe by even minutes.
    evictMediaCache(removed.map((r) => r.key));
  }
  // Scrub PII; the skeletal row survives for audit (deliberately NOT deleted).
  // Clear both request flags in the same scrub so the account leaves the banner.
  await d
    .update(accounts)
    .set({ email: null, displayName: null, phone: null, phoneVerifiedAt: null, deletionRequestedAt: null, dataRequestedAt: null })
    .where(eq(accounts.id, accountId));

  const supabase = serviceAuthClient();
  if (!supabase) return { authDeleted: false };
  const { error } = await supabase.auth.admin.deleteUser(accountId);
  return { authDeleted: !error };
}
