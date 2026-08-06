/**
 * Ops analytics (docs/ADMIN.md §12): first-party numbers computed from the
 * shared DB seams (materialized views when volume demands it). Accuracy law
 * (ANALYTICS.md) — ops numbers come from our own data, never client capture.
 */
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { profilesApi } from '@/app/api/profiles';
import { serviceCategory, SERVICE_CATEGORIES } from '@/lib/taxonomy';
import { listAudit } from './lib';
import { listProfilesAdmin } from './entities';
import type { Service } from '@/lib/taxonomy';

export interface Analytics {
  verification: { pending: number; approved: number; rejected: number; unverified: number };
  reports: { open: number; resolved: number; dismissed: number; escalations: number };
  reportReasons: { reason: string; count: number }[];
  completenessBuckets: { label: string; count: number }[];
  byServiceCategory: { category: string; count: number }[];
  adminThroughput: { admin: string; actions: number }[];
  totals: { profiles: number; accounts: number; auditEntries: number };
}

export async function analytics(): Promise<Analytics> {
  const [accounts, reports, { items: profiles }, rows, audit] = await Promise.all([
    accountApi.all(),
    reportsApi.list(),
    profilesApi.list({ limit: 60 }),
    listProfilesAdmin(),
    listAudit(),
  ]);

  const vs = { pending: 0, approved: 0, rejected: 0, unverified: 0 };
  for (const a of accounts) vs[a.idVerification] = (vs[a.idVerification] ?? 0) + 1;

  const rState = { open: 0, resolved: 0, dismissed: 0 };
  const reasonMap = new Map<string, number>();
  let escalations = 0;
  for (const r of reports) {
    rState[r.state] = (rState[r.state] ?? 0) + 1;
    reasonMap.set(r.reason, (reasonMap.get(r.reason) ?? 0) + 1);
    if (r.state === 'open' && r.escalated) escalations++;
  }

  const buckets = { '0–49%': 0, '50–74%': 0, '75–100%': 0 };
  for (const r of rows) {
    if (r.completeness < 50) buckets['0–49%']++;
    else if (r.completeness < 75) buckets['50–74%']++;
    else buckets['75–100%']++;
  }

  const cat = new Map<string, number>();
  for (const p of profiles) {
    const cats = new Set<string>();
    for (const s of p.services) {
      try { cats.add(serviceCategory(s as Service)); } catch { /* skip legacy/unknown */ }
    }
    for (const c of cats) cat.set(c, (cat.get(c) ?? 0) + 1);
  }

  const throughput = new Map<string, number>();
  for (const e of audit) throughput.set(e.adminEmail, (throughput.get(e.adminEmail) ?? 0) + 1);

  return {
    verification: vs,
    reports: { open: rState.open, resolved: rState.resolved, dismissed: rState.dismissed, escalations },
    reportReasons: [...reasonMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    completenessBuckets: Object.entries(buckets).map(([label, count]) => ({ label, count })),
    byServiceCategory: SERVICE_CATEGORIES.map((category) => ({ category, count: cat.get(category) ?? 0 })).sort((a, b) => b.count - a.count),
    adminThroughput: [...throughput.entries()].map(([admin, actions]) => ({ admin: admin.split('@')[0]!, actions })).sort((a, b) => b.actions - a.actions),
    totals: { profiles: rows.length, accounts: accounts.length, auditEntries: audit.length },
  };
}
