/**
 * Retention purge (SECURITY.md §8 + hard rule 3). Run by the standalone purge
 * cron worker (workers/purge/) through the bearer-gated /api/purge endpoint, so
 * it executes with the main worker's DB + R2 bindings.
 *
 *  · Messages past their 90-day window are deleted — inline photo bytes live in
 *    the row (image_key data-URL), so the row delete removes them too.
 *  · Verification docs past `purge_after` have their R2 object deleted; the
 *    skeletal row (state/hash/reviewer/date) is retained forever — provability
 *    keeps the record, not the toxic document. `purged_at` marks it done so the
 *    cron never re-processes a row.
 *
 * All time comparisons use the DB's own now()/current_date (never a bound JS
 * Date — postgres-js can't type a bare Date under prepare:false).
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { messages, verificationDocs } from '@/db/schema';

export interface PurgeResult {
  messages: number;
  vdocs: number;
}

export async function runRetentionPurge(d: Db, verificationBucket: R2Bucket): Promise<PurgeResult> {
  // 1. Expired messages (bytes included, since photos are inline in the row).
  const delMsgs = await d
    .delete(messages)
    .where(lt(messages.expiresAt, sql`now()`))
    .returning({ id: messages.id });

  // 2. Verification docs past retention: delete the R2 object, keep the row.
  const stale = await d
    .select({ id: verificationDocs.id, key: verificationDocs.r2Key })
    .from(verificationDocs)
    .where(and(lt(verificationDocs.purgeAfter, sql`current_date`), isNull(verificationDocs.purgedAt)));
  for (const v of stale) {
    await verificationBucket.delete(v.key);
    await d.update(verificationDocs).set({ purgedAt: sql`now()` }).where(eq(verificationDocs.id, v.id));
  }

  return { messages: delMsgs.length, vdocs: stale.length };
}
