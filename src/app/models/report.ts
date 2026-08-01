/**
 * Reports domain (docs/ADMIN.md §7). Filed by users, triaged by admins — a
 * SHARED seam (not admin-only): user actions call `file`, admin actions call
 * `list`/`resolve`/`dismiss`. Keeps the admin import-boundary intact (admin may
 * import shared; nothing imports admin).
 */
import { z } from 'zod';
import { ESCALATION_REASONS, REPORT_REASONS, REPORT_RESOLUTIONS, REPORT_STATES, REPORT_TARGETS } from '@/lib/taxonomy';
import type { Session } from '@/app/models/session';

export const ReportSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  reporterEmail: z.string(),
  targetKind: z.enum(REPORT_TARGETS),
  targetId: z.string(),
  /** Human label for admin display (profile name / message snippet). */
  targetLabel: z.string().default(''),
  profileSlug: z.string().optional(),
  threadId: z.string().optional(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(1000).default(''),
  state: z.enum(REPORT_STATES).default('open'),
  /** underage/coercion → pinned + site-wide admin banner (§4, §7). */
  escalated: z.boolean().default(false),
  resolution: z.enum(REPORT_RESOLUTIONS).optional(),
  resolutionNote: z.string().default(''),
  handledBy: z.string().optional(),
  handledAt: z.string().optional(),
});
export type Report = z.infer<typeof ReportSchema>;

export const isEscalation = (reason: string): boolean =>
  (ESCALATION_REASONS as readonly string[]).includes(reason);

export interface ReportsApi {
  /** User files a report. */
  file(
    session: Session,
    input: {
      targetKind: Report['targetKind'];
      targetId: string;
      targetLabel?: string;
      profileSlug?: string;
      threadId?: string;
      reason: Report['reason'];
      note?: string;
    },
  ): Promise<Report>;

  // admin triage
  list(): Promise<Report[]>;
  byId(id: string): Promise<Report | null>;
  resolve(input: { id: string; resolution: Report['resolution']; note?: string; handledBy: string }): Promise<void>;
  dismiss(input: { id: string; note?: string; handledBy: string }): Promise<void>;
  openCount(): Promise<number>;
  escalationCount(): Promise<number>;
}
