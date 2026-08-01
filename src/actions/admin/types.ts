/**
 * Admin domain types (docs/ADMIN.md). Lives inside the admin fence
 * (src/actions/admin/**) — imported only by admin pages/actions/components.
 */
import type { AdminAction, AdminRole, VerificationState } from '@/lib/taxonomy';
import type { Report } from '@/app/models/report';

/** One immutable audit-log line (ADMIN.md §0.3 — every action + sensitive read). */
export interface AuditEntry {
  id: string;
  at: string;
  adminEmail: string;
  adminRole: AdminRole;
  action: AdminAction;
  entityType: string;
  entityId: string;
  reason?: string;
  meta?: Record<string, string>;
}

/** A soft lock while an admin reviews a queue item (broadcast "X is reviewing"). */
export interface Claim {
  by: string;
  at: string;
}

/** Verification queue row (§5) — derived from accounts in `pending`. */
export interface VerificationItem {
  email: string;
  profileId?: string;
  profileName: string;
  profileSlug?: string;
  submittedAt: string;
  phoneVerified: boolean;
  state: VerificationState;
  claim: Claim | null;
}

/** A field-level change for the moderation diff view (§6). */
export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

/** Moderation queue row (§6) — new/edited profiles + flagged media. */
export interface ModerationItem {
  id: string;
  kind: 'new_profile' | 'profile_edit' | 'media';
  profileId: string;
  profileName: string;
  profileSlug: string;
  submittedAt: string;
  diff: FieldDiff[];
  media: { id: string; imageKey: string; nsfwScore: number }[];
  claim: Claim | null;
}

/** Reports queue row = a Report plus its claim. */
export interface ReportItem extends Report {
  claim: Claim | null;
}

/** Overview cockpit payload (§4). */
export interface Overview {
  queues: { verification: number; moderation: number; reports: number };
  oldest: { verification: string | null; moderation: string | null; reports: string | null };
  today: { registrations: number; submitted: number; published: number; reports: number };
  escalations: number;
  onlineNow: number;
  supply: { city: string; live: number; target: number }[];
}
