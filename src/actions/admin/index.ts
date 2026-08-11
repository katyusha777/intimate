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
import { claimItem, record, releaseItem, requireAdmin, requireOwner } from './lib';

const sessionKv = () => (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;
import { and, eq, isNotNull } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { accounts, media, profiles } from '@/db/schema';
import { approveWholeSubmission, decideModeration } from './queues';
import { setProfileState } from './entities';
import { approveDeletion, exportAccountData } from './gdpr';
import { retryImport } from './imports';
import { assignProfileToOrg, createOrg, setOrgLogo, updateOrg } from './orgs';
import { importFromUrl } from '@/lib/import';
import { agencyImportFromUrl, discoverProfileUrls } from '@/lib/import/agency';
import { enqueueOrgCrawl, processImportJobs } from '@/app/api/crawl';
import { dataUrlToJpegBytes } from '@/lib/jpeg-strip';
import { CITIES, type CitySlug } from '@/lib/taxonomy';
import { INDEXNOW_KEY, submitIndexNow } from '@/lib/indexnow';
import { evictMediaCache, isR2Key, mediaBucket } from '@/lib/media-keys';
import { ADMIN_EVENTS, NOTIFY_PREFS_KEY } from '@/lib/pushover';
import { LOCALES, type AdminAction, type ProfileState } from '@/lib/taxonomy';

const adb = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
const CITY_SLUG_VALUES = CITIES.map((c) => c.slug) as unknown as [CitySlug, ...CitySlug[]];

/** IndexNow ping for a profile's locale URLs — new live page, or its takedown
 *  410 (SEO.md §1.6). Best-effort, never throws; awaited so workerd doesn't
 *  cancel the fetch after the response. */
async function pingIndexNow(origin: string, slug: string): Promise<void> {
  const urls = LOCALES.map((l) => `${origin}/${l}/profile/${slug}/`);
  await submitIndexNow(urls, new URL(origin).host, `${origin}/${INDEXNOW_KEY}.txt`);
}

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

  // --- account type correction (§8): support/super ---
  // A mis-registered client (or advertiser) fixed from the users panel. Never
  // touches admin accounts and can't grant admin (enum forbids it) — no
  // privilege change happens here. session.role reads accounts.accountType, so
  // the column update IS the switch.
  setAccountType: defineAction({
    input: z.object({ accountId: z.string().uuid(), type: z.enum(['client', 'advertiser']) }),
    handler: async ({ accountId, type }, context) => {
      const session = await requireAdmin(context, ['support']);
      const target = (await accountApi.all()).find((a) => a.id === accountId);
      if (!target) throw new ActionError({ code: 'NOT_FOUND', message: 'account not found' });
      if (target.accountType === 'admin') throw new ActionError({ code: 'FORBIDDEN', message: 'cannot change an admin account' });
      if (target.accountType !== type) {
        await accountApi.setAccountType(accountId, type);
        await record(session, {
          action: 'set_account_type',
          entityType: 'account',
          entityId: target.email,
          meta: { from: target.accountType, to: type },
        });
      }
      return { ok: true };
    },
  }),

  // --- verification (§5): moderator/super ---
  // NB: the doc READ itself is audited at the serve route (src/pages/admin/vdoc/[id].ts),
  // not via a client action — so there's no verificationDocViewed action here.
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
        // Merge: approving the ID also publishes their submitted profile + photos.
        await approveWholeSubmission({ email });
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
      // Approving from the directory also clears ID verification + photos (merge).
      if (action === 'approve') await approveWholeSubmission({ profileId: id });
      await bustProfiles(sessionKv()); // lifecycle change → drop the edge cache
      // Tell engines to re-crawl: a new live page, or the takedown's 410.
      if (action === 'approve' || action === 'block' || action === 'delete') {
        const [p] = await adb().select({ slug: profiles.slug }).from(profiles).where(eq(profiles.id, id)).limit(1);
        if (p?.slug) await pingIndexNow(new URL(context.request.url).origin, p.slug);
      }
      await record(session, { action: m.audit, entityType: 'profile', entityId: id, reason });
      return { ok: true };
    },
  }),

  // --- single-photo takedown (in-place moderation from the public page, §8) ---
  mediaReject: defineAction({
    input: z.object({
      profileId: z.string().max(60),
      /** Served photo URL (public projection has no media ids) — key derived server-side. */
      url: z.string().max(500),
    }),
    handler: async ({ profileId, url }, context) => {
      const session = await requireAdmin(context, ['moderator']);
      const imageKey = url.replace(/^\/media\//, '');
      const rows = await adb()
        .update(media)
        .set({ state: 'rejected' })
        .where(and(eq(media.profileId, profileId), eq(media.imageKey, imageKey)))
        .returning({ id: media.id, key: media.imageKey });
      if (!rows.length) throw new ActionError({ code: 'NOT_FOUND', message: 'photo not found' });
      // Delete the bytes AND evict the edge copy — a rejected photo must not
      // keep serving from its (already-known) pub URL. The /media route's
      // media-row gate ('rejected' blocks before the cache lookup) is the
      // global guarantee; the evict makes the serving colo instant.
      if (isR2Key(rows[0]!.key)) {
        await mediaBucket().delete(rows[0]!.key);
        evictMediaCache([rows[0]!.key]);
      }
      await bustProfiles(sessionKv());
      await record(session, { action: 'reject_media', entityType: 'media', entityId: rows[0]!.id });
      return { ok: true };
    },
  }),

  // --- admin notification config (/admin/settings, super-only) ---
  setPushoverKey: defineAction({
    input: z.object({ accountId: z.string().max(60), key: z.string().trim().max(60) }),
    handler: async ({ accountId, key }, context) => {
      const session = await requireAdmin(context, ['super']);
      const clean = key.trim();
      // Pushover user keys are 30 alphanumerics; empty clears the key.
      if (clean && !/^[A-Za-z0-9]{30}$/.test(clean)) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'invalid Pushover key (30 letters/digits)' });
      }
      const rows = await adb()
        .update(accounts)
        .set({ pushoverKey: clean || null })
        .where(and(eq(accounts.id, accountId), isNotNull(accounts.adminRole)))
        .returning({ email: accounts.email });
      if (!rows.length) throw new ActionError({ code: 'NOT_FOUND', message: 'admin account not found' });
      await record(session, { action: 'set_pushover_key', entityType: 'account', entityId: rows[0]!.email ?? accountId });
      return { ok: true };
    },
  }),

  setNotifyPrefs: defineAction({
    input: z.object({ prefs: z.record(z.string(), z.boolean()) }),
    handler: async ({ prefs }, context) => {
      const session = await requireAdmin(context, ['super']);
      const kv = sessionKv();
      if (!kv) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'KV unavailable' });
      // Only known event keys survive — junk can't accumulate in the pref blob.
      const known = Object.fromEntries(
        ADMIN_EVENTS.filter((ev) => ev.key in prefs).map((ev) => [ev.key, !!prefs[ev.key]]),
      );
      await kv.put(NOTIFY_PREFS_KEY, JSON.stringify(known));
      await record(session, { action: 'set_notify_prefs', entityType: 'config', entityId: 'notify:prefs' });
      return { ok: true };
    },
  }),

  // --- owner-only raw-data tools (/admin/danger, ADMIN.md §1) ---
  ownerClearPhone: defineAction({
    input: z.object({ accountId: z.string().max(60) }),
    handler: async ({ accountId }, context) => {
      const session = await requireOwner(context);
      const rows = await adb()
        .update(accounts)
        .set({ phone: null, phoneVerifiedAt: null })
        .where(eq(accounts.id, accountId))
        .returning({ email: accounts.email, phone: accounts.phone });
      if (!rows.length) throw new ActionError({ code: 'NOT_FOUND', message: 'account not found' });
      await record(session, { action: 'owner_clear_phone', entityType: 'account', entityId: rows[0]!.email ?? accountId });
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

  // Import test tool (/admin/imports/test): scrape+normalize a URL and see the
  // raw LLM output beside our mapped fields — how you verify the mapping holds.
  importPreview: defineAction({
    input: z.object({ url: z.string().url().max(500) }),
    handler: async ({ url }, context) => {
      await requireAdmin(context, ['moderator']);
      try {
        const { site, fields, warnings, raw, cost } = await importFromUrl(url);
        return { site, fields, warnings, raw, cost };
      } catch (e) {
        throw new ActionError({ code: 'BAD_REQUEST', message: (e as Error).message });
      }
    },
  }),
  // Apply an import directly onto a profile by id (super-only, audit-logged).
  importApply: defineAction({
    input: z.object({ profileId: z.string().uuid(), url: z.string().url().max(500) }),
    handler: async ({ profileId, url }, context) => {
      const session = await requireAdmin(context, ['super']);
      try {
        const { fields, warnings } = await importFromUrl(url);
        await accountApi.saveProfileById(profileId, fields);
        await adb().update(profiles).set({ importedFromUrl: url }).where(eq(profiles.id, profileId));
        await record(session, { action: 'edit_profile_admin', entityType: 'profile', entityId: profileId, meta: { note: `import from ${url}` } });
        return { ok: true, fields, warnings };
      } catch (e) {
        throw new ActionError({ code: 'BAD_REQUEST', message: (e as Error).message });
      }
    },
  }),

  // --- partner agencies (§8): CRUD/crawl super, previews moderator ---
  orgCreate: defineAction({
    input: z.object({
      name: z.string().min(2).max(80),
      city: z.enum(CITY_SLUG_VALUES),
      kvk: z.string().max(20).optional(),
      siteUrl: z.string().url().max(300).optional(),
      contactEmail: z.string().email().max(200).optional(),
      contactPhone: z.string().max(30).optional(),
      description: z.string().max(2000).optional(),
      crawlListUrl: z.string().url().max(500).optional(),
    }),
    handler: async (input, context) => {
      const session = await requireAdmin(context, ['super']);
      const id = await createOrg(input);
      await record(session, { action: 'create_org', entityType: 'org', entityId: id, meta: { name: input.name } });
      return { id };
    },
  }),

  orgUpdate: defineAction({
    input: z.object({
      id: z.string().uuid(),
      name: z.string().min(2).max(80).optional(),
      city: z.enum(CITY_SLUG_VALUES).optional(),
      kvk: z.string().max(20).optional(),
      verified: z.boolean().optional(),
      siteUrl: z.string().url().max(300).or(z.literal('')).optional(),
      contactEmail: z.string().email().max(200).or(z.literal('')).optional(),
      contactPhone: z.string().max(30).optional(),
      description: z.string().max(2000).optional(),
      crawlEnabled: z.boolean().optional(),
      crawlListUrl: z.string().url().max(500).or(z.literal('')).optional(),
    }),
    handler: async ({ id, ...patch }, context) => {
      const session = await requireAdmin(context, ['super']);
      await updateOrg(id, patch);
      await record(session, { action: 'edit_org', entityType: 'org', entityId: id });
      return { ok: true };
    },
  }),

  // Logo: client-side canvas re-encode (EXIF gone) + server re-decode, same
  // trust chain as profile photos (hard rule 2).
  orgSetLogo: defineAction({
    input: z.object({
      id: z.string().uuid(),
      dataUrl: z.string().regex(/^data:image\/jpeg;base64,/).max(900_000),
    }),
    handler: async ({ id, dataUrl }, context) => {
      const session = await requireAdmin(context, ['super']);
      let bytes: ArrayBuffer;
      try {
        bytes = dataUrlToJpegBytes(dataUrl);
      } catch {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'invalid image' });
      }
      const key = await setOrgLogo(id, bytes);
      await record(session, { action: 'edit_org', entityType: 'org', entityId: id, meta: { note: 'logo' } });
      return { key };
    },
  }),

  orgAssignProfile: defineAction({
    input: z.object({ profileId: z.string().uuid(), orgId: z.string().uuid().nullable() }),
    handler: async ({ profileId, orgId }, context) => {
      const session = await requireAdmin(context, ['super']);
      await assignProfileToOrg(profileId, orgId);
      await record(session, {
        action: 'edit_org',
        entityType: 'profile',
        entityId: profileId,
        meta: { note: orgId ? `assigned to org ${orgId}` : 'unassigned from org' },
      });
      return { ok: true };
    },
  }),

  // Crawl test tools (/admin/organizations): read-only previews, no DB writes.
  orgDiscoverPreview: defineAction({
    input: z.object({ url: z.string().url().max(500) }),
    handler: async ({ url }, context) => {
      await requireAdmin(context, ['moderator']);
      try {
        return await discoverProfileUrls(url);
      } catch (e) {
        throw new ActionError({ code: 'BAD_REQUEST', message: (e as Error).message });
      }
    },
  }),
  orgImportPreview: defineAction({
    input: z.object({ url: z.string().url().max(500) }),
    handler: async ({ url }, context) => {
      await requireAdmin(context, ['moderator']);
      try {
        const { fields, warnings, name, age, photoUrls, raw, cost } = await agencyImportFromUrl(url);
        return { fields, warnings, name, age, photoUrls, raw, cost };
      } catch (e) {
        throw new ActionError({ code: 'BAD_REQUEST', message: (e as Error).message });
      }
    },
  }),

  // "Crawl now": discovery + queue. The page then loops orgProcessJobs to
  // drain the queue with visible progress (the cron tick drains it too).
  orgCrawl: defineAction({
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => {
      const session = await requireAdmin(context, ['super']);
      try {
        const result = await enqueueOrgCrawl(id);
        await record(session, {
          action: 'crawl_org',
          entityType: 'org',
          entityId: id,
          meta: { discovered: String(result.discovered), new: String(result.queuedNew), updates: String(result.queuedUpdates) },
        });
        return result;
      } catch (e) {
        throw new ActionError({ code: 'BAD_REQUEST', message: (e as Error).message });
      }
    },
  }),
  // Mechanical queue drain (one job per call — browser-loop friendly). The
  // intent was audited by orgCrawl; per-job outcomes live on import_jobs rows.
  orgProcessJobs: defineAction({
    input: z.object({}).optional(),
    handler: async (_input, context) => {
      await requireAdmin(context, ['super']);
      return await processImportJobs(1);
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

  // --- GDPR fulfilment (items.md #6/#7): super only ---
  gdprExport: defineAction({
    input: z.object({ accountId: z.string().max(60) }),
    handler: async ({ accountId }, context) => {
      const session = await requireAdmin(context, ['super']);
      const data = await exportAccountData(accountId);
      // Do NOT clear the request flag here: the export button must stay
      // available (re-downloadable) until the account is permanently deleted
      // (#2). approveDeletion clears both flags when the account is removed.
      await record(session, { action: 'gdpr_export', entityType: 'account', entityId: accountId });
      return { data };
    },
  }),

  gdprApproveDeletion: defineAction({
    input: z.object({ accountId: z.string().max(60) }),
    handler: async ({ accountId }, context) => {
      const session = await requireAdmin(context, ['super']);
      const { authDeleted } = await approveDeletion(accountId);
      await record(session, {
        action: 'delete_account',
        entityType: 'account',
        entityId: accountId,
        meta: { authDeleted: String(authDeleted) },
      });
      await bustProfiles(sessionKv()); // her cached public pages must go stale now
      return { ok: true, authDeleted };
    },
  }),
};
