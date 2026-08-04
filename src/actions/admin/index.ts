/**
 * Admin actions (docs/ADMIN.md). Every one: role-guarded (never UI-only) and
 * audit-logged. Registered into the app action tree by src/actions/index.ts
 * (the one sanctioned cross-fence import). In prod the guard also asserts
 * MFA/aal2 and the service-role client is constructed here — nowhere else.
 */
import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro:schema';
import { accountApi } from '@/app/api/account';
import { reportsApi } from '@/app/api/reports';
import { env } from 'cloudflare:workers';
import { REJECTION_REASONS, REPORT_RESOLUTIONS } from '@/lib/taxonomy';
import { bustProfiles, type CacheKv } from '@/lib/page-cache';
import { listWarmUrls } from '@/lib/warm';
import { claimItem, record, releaseItem, requireAdmin } from './lib';

const sessionKv = () => (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;
import { decideModeration } from './queues';
import { setProfileState } from './entities';
import { retryImport } from './imports';
import type { AdminAction, ProfileState } from '@/lib/taxonomy';

export const admin = {
  // --- queue claims (broadcast "X is reviewing", §5) ---
  claim: defineAction({
    input: z.object({ itemKey: z.string().max(200) }),
    handler: async ({ itemKey }, context) => {
      const session = await requireAdmin(context);
      await claimItem(session, itemKey);
      await record(session, { action: 'claim_item', entityType: 'queue', entityId: itemKey });
      return { ok: true };
    },
  }),
  release: defineAction({
    input: z.object({ itemKey: z.string().max(200) }),
    handler: async ({ itemKey }, context) => {
      const session = await requireAdmin(context);
      await releaseItem(session, itemKey);
      return { ok: true };
    },
  }),

  // --- verification (§5): moderator/super ---
  verificationDocViewed: defineAction({
    // The sensitive read itself is logged (doc reveal → audit, §5).
    input: z.object({ email: z.string().email() }),
    handler: async ({ email }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      await record(session, { action: 'verification_doc_viewed', entityType: 'account', entityId: email });
      return { ok: true };
    },
  }),
  verificationDecision: defineAction({
    input: z.object({
      email: z.string().email(),
      decision: z.enum(['approve', 'reject']),
      reason: z.enum(REJECTION_REASONS).optional(),
      note: z.string().max(500).optional(),
    }),
    handler: async ({ email, decision, reason, note }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      if (decision === 'reject' && !reason) throw new ActionError({ code: 'BAD_REQUEST', message: 'reason required' });
      if (decision === 'approve') {
        await accountApi.saveByEmail(email, { idVerification: 'approved', verificationReason: undefined });
        await record(session, { action: 'approve_verification', entityType: 'account', entityId: email });
      } else {
        await accountApi.saveByEmail(email, { idVerification: 'rejected', verificationReason: reason });
        await record(session, {
          action: 'reject_verification',
          entityType: 'account',
          entityId: email,
          reason,
          meta: note ? { note } : undefined,
        });
      }
      await releaseItem(session, `verify:${email.toLowerCase()}`);
      return { ok: true };
    },
  }),

  // --- moderation (§6): moderator/super ---
  moderationDecision: defineAction({
    input: z.object({
      id: z.string().max(120),
      decision: z.enum(['approve', 'reject']),
      reason: z.enum(REJECTION_REASONS).optional(),
    }),
    handler: async ({ id, decision, reason }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      if (decision === 'reject' && !reason) throw new ActionError({ code: 'BAD_REQUEST', message: 'reason required' });
      await decideModeration(id, decision === 'approve');
      await record(session, {
        action: decision === 'approve' ? 'approve_profile' : 'reject_profile',
        entityType: 'moderation',
        entityId: id,
        reason,
      });
      await releaseItem(session, `mod:${id}`);
      return { ok: true };
    },
  }),

  // --- reports (§7): moderator/super ---
  reportDecision: defineAction({
    input: z.object({
      id: z.string().max(60),
      decision: z.enum(['resolve', 'dismiss']),
      resolution: z.enum(REPORT_RESOLUTIONS).optional(),
      note: z.string().max(500).optional(),
    }),
    handler: async ({ id, decision, resolution, note }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      if (decision === 'resolve') {
        if (!resolution) throw new ActionError({ code: 'BAD_REQUEST', message: 'resolution required' });
        await reportsApi.resolve({ id, resolution, note, handledBy: session.accountId });
        await record(session, { action: 'resolve_report', entityType: 'report', entityId: id, reason: resolution, meta: note ? { note } : undefined });
      } else {
        await reportsApi.dismiss({ id, note, handledBy: session.accountId });
        await record(session, { action: 'dismiss_report', entityType: 'report', entityId: id, meta: note ? { note } : undefined });
      }
      await releaseItem(session, `report:${id}`);
      return { ok: true };
    },
  }),

  // --- profile lifecycle (§8): moderator/super ---
  profileState: defineAction({
    input: z.object({
      id: z.string().max(60),
      action: z.enum(['approve', 'pause', 'block', 'unblock', 'delete']),
      reason: z.string().max(200).optional(),
    }),
    handler: async ({ id, action, reason }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      const map: Record<string, { state: ProfileState; audit: AdminAction }> = {
        approve: { state: 'live', audit: 'approve_profile' },
        pause: { state: 'paused', audit: 'edit_profile_admin' },
        block: { state: 'blocked', audit: 'block_profile' },
        unblock: { state: 'live', audit: 'unblock_profile' },
        delete: { state: 'deleted', audit: 'delete_profile' },
      };
      const m = map[action]!;
      await setProfileState(id, m.state, session.email, reason);
      await bustProfiles(sessionKv()); // lifecycle change → drop the edge cache
      await record(session, { action: m.audit, entityType: 'profile', entityId: id, reason });
      return { ok: true };
    },
  }),

  // --- edge cache control (docs/ARCHITECTURE §4): super-only ---
  cachePurge: defineAction({
    input: z.object({}),
    handler: async (_input, context) => {
      const session = await requireAdmin(context, []); // [] → super-only
      await bustProfiles(sessionKv());
      await record(session, {
        action: 'add_note',
        entityType: 'cache',
        entityId: 'profiles',
        meta: { note: 'purge edge cache' },
      });
      return { ok: true };
    },
  }),

  // Returns the live-profile URLs; the admin's BROWSER fetches them to warm the
  // cache (the worker can't self-fetch — Cloudflare loops it back to 522).
  cacheWarmUrls: defineAction({
    input: z.object({}),
    handler: async (_input, context) => {
      await requireAdmin(context, []); // [] → super-only
      const origin = new URL(context.request.url).origin;
      const hyperdrive = (env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE;
      return { urls: await listWarmUrls({ origin, hyperdrive }) };
    },
  }),

  // --- imports (§3): moderator/super ---
  importRetry: defineAction({
    input: z.object({ id: z.string().max(60) }),
    handler: async ({ id }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      await retryImport(id);
      await record(session, { action: 'add_note', entityType: 'import', entityId: id, meta: { note: 'retry' } });
      return { ok: true };
    },
  }),

  // --- escalate to super (§5, §7) ---
  escalate: defineAction({
    input: z.object({ entityType: z.string().max(40), entityId: z.string().max(200) }),
    handler: async ({ entityType, entityId }, context) => {
      const session = await requireAdmin(context);
      await record(session, { action: 'escalate', entityType, entityId });
      return { ok: true };
    },
  }),
};
