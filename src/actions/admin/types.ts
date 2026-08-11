/**
 * Admin domain types (docs/ADMIN.md). Lives inside the admin fence
 * (src/actions/admin/**) — imported only by admin pages/actions/components.
 */
import type { AdminAction, AdminRole } from '@/lib/taxonomy';
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

/**
 * Profile approval queue row (§5) — one item per pending submission, unifying
 * what used to be two queues: the ID document (`idPending`), the profile's
 * first publish (`profilePending`), and its pending photos (`media`). Keyed by
 * `profile:<id>` when a profile exists, else `acct:<email>` (ID with no profile
 * yet). One review, one decision — an admin never approves the same person
 * twice.
 */
export interface ApprovalItem {
  key: string;
  email: string | null;
  profileId?: string;
  profileName: string;
  profileSlug?: string;
  birthDate?: string | null;
  city?: string | null;
  phoneVerified: boolean;
  submittedAt: string;
  idPending: boolean;
  profilePending: boolean;
  media: { id: string; imageKey: string; nsfwScore: number }[];
  claim: Claim | null;
}

/** Reports queue row = a Report plus its claim. */
export interface ReportItem extends Report {
  claim: Claim | null;
}

/** Overview cockpit payload (§4). */
export interface Overview {
  queues: { approvals: number; reports: number };
  oldest: { approvals: string | null; reports: string | null };
  today: { registrations: number; submitted: number; published: number; reports: number };
  escalations: number;
  onlineNow: number;
  supply: { city: string; live: number; target: number }[];
}
