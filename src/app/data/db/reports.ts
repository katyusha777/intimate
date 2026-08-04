/**
 * Drizzle reports backend (docs/ADMIN.md §7, DATA.md): users file, admins
 * triage. Replaces the KV list. `reporter_account_id` / `handled_by` are uuids;
 * the model's `reporterEmail` / `handledBy` project from account joins.
 *
 * Factored as makeReportsApi(db) so it's unit-testable; the seam
 * (api/reports.ts) injects the Hyperdrive binding.
 */
import { aliasedTable, and, eq, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { accounts, reports } from '@/db/schema';
import { isEscalation, type Report, type ReportsApi } from '@/app/models/report';

const iso = (v: Date | null): string | undefined => v?.toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reporter = aliasedTable(accounts, 'reporter');
const handler = aliasedTable(accounts, 'handler');

/** reports ⟕ reporter ⟕ handler → the Report model. */
function selectReports(db: () => Db) {
  return db()
    .select({
      id: reports.id,
      createdAt: reports.createdAt,
      reporterEmail: reporter.email,
      targetKind: reports.targetKind,
      targetId: reports.targetId,
      targetLabel: reports.targetLabel,
      profileSlug: reports.profileSlug,
      threadId: reports.threadId,
      reason: reports.reason,
      note: reports.note,
      state: reports.state,
      escalated: reports.escalated,
      resolution: reports.resolution,
      resolutionNote: reports.resolutionNote,
      handledBy: handler.email,
      handledAt: reports.handledAt,
    })
    .from(reports)
    .leftJoin(reporter, eq(reporter.id, reports.reporterAccountId))
    .leftJoin(handler, eq(handler.id, reports.handledBy));
}

type Row = Awaited<ReturnType<typeof selectReports>>[number];
function toReport(r: Row): Report {
  return {
    id: r.id,
    createdAt: iso(r.createdAt)!,
    reporterEmail: r.reporterEmail ?? '',
    targetKind: r.targetKind,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    profileSlug: r.profileSlug ?? undefined,
    threadId: r.threadId ?? undefined,
    reason: r.reason,
    note: r.note,
    state: r.state,
    escalated: r.escalated,
    resolution: r.resolution ?? undefined,
    resolutionNote: r.resolutionNote,
    handledBy: r.handledBy ?? undefined,
    handledAt: iso(r.handledAt),
  };
}

export function makeReportsApi(db: () => Db): ReportsApi {
  return {
    async file(session, input) {
      const [row] = await db()
        .insert(reports)
        .values({
          reporterAccountId: session.accountId,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetLabel: input.targetLabel ?? '',
          profileSlug: input.profileSlug,
          // thread_id is a real FK — only set it when it's a uuid (message reports).
          threadId: input.threadId && UUID.test(input.threadId) ? input.threadId : null,
          reason: input.reason,
          note: input.note ?? '',
          escalated: isEscalation(input.reason),
        })
        .returning({ id: reports.id });
      return (await selectReports(db).where(eq(reports.id, row!.id)))
        .map(toReport)[0]!;
    },

    async list() {
      return (await selectReports(db).orderBy(reports.createdAt)).map(toReport);
    },

    async byId(id) {
      return (await selectReports(db).where(eq(reports.id, id))).map(toReport)[0] ?? null;
    },

    async resolve({ id, resolution, note, handledBy }) {
      await db()
        .update(reports)
        .set({
          state: 'resolved',
          resolution,
          resolutionNote: note ?? '',
          handledBy, // admin account id (uuid)
          handledAt: sql`now()`,
        })
        .where(eq(reports.id, id));
    },

    async dismiss({ id, note, handledBy }) {
      await db()
        .update(reports)
        .set({ state: 'dismissed', resolutionNote: note ?? '', handledBy, handledAt: sql`now()` })
        .where(eq(reports.id, id));
    },

    async openCount() {
      const [r] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(reports)
        .where(eq(reports.state, 'open'));
      return r?.n ?? 0;
    },

    async escalationCount() {
      const [r] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(reports)
        .where(and(eq(reports.state, 'open'), eq(reports.escalated, true)));
      return r?.n ?? 0;
    },
  };
}
