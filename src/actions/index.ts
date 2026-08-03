/**
 * Server actions (CLAUDE.md conventions): Zod-validated, run inside the
 * Cloudflare Worker — API keys never reach the client.
 */
import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { ProfileEditSchema } from "@/app/models/account";
import { accountApi } from "@/app/api/account";
import { messagingApi } from "@/app/api/messaging";
import { reportsApi } from "@/app/api/reports";
import { sessionApi } from "@/app/api/session";
import { CONVERSATION_MODES, REPORT_REASONS, REPORT_TARGETS } from "@/lib/taxonomy";
// The one sanctioned cross-fence import: the action registry wires in admin.
import { admin } from "@/actions/admin";
import {
  ALL_SERVICES,
  LOCALES,
  RATE_DURATIONS,
  REQUEST_WHEN,
} from "@/lib/taxonomy";

/** Actions run with the request context — sessions verified per request. */
async function requireSession(context: Parameters<typeof sessionApi.current>[0]) {
  const session = await sessionApi.current(context);
  if (!session) throw new ActionError({ code: "UNAUTHORIZED" });
  return session;
}

export const server = {
  auth: {
    register: defineAction({
      input: z.object({
        email: z.string().email(),
        password: z.string().min(8), // dashboard minimum mirrors this
        role: z.enum(["advertiser", "client"]),
        locale: z.enum(LOCALES),
      }),
      handler: async ({ email, password, role, locale }, context) => {
        try {
          const { needsConfirmation } = await sessionApi.register(context, { email, password, role });
          if (needsConfirmation) return { href: null, needsConfirmation: true };
          return { href: `/${locale}/account/`, needsConfirmation: false };
        } catch (e) {
          throw new ActionError({ code: "BAD_REQUEST", message: (e as Error).message });
        }
      },
    }),

    login: defineAction({
      input: z.object({
        email: z.string().email(),
        password: z.string().min(1),
        locale: z.enum(LOCALES),
      }),
      handler: async ({ email, password, locale }, context) => {
        const session = await sessionApi.signIn(context, { email, password });
        if (!session) throw new ActionError({ code: "UNAUTHORIZED" });
        return { href: `/${locale}/account/` };
      },
    }),

    logout: defineAction({
      input: z.object({ locale: z.enum(LOCALES) }),
      handler: async ({ locale }, context) => {
        await sessionApi.signOut(context);
        return { href: `/${locale}/` };
      },
    }),
  },

  account: {
    saveProfile: defineAction({
      input: z.object({ patch: z.any() }),
      handler: async ({ patch }, context) => {
        const session = await requireSession(context);
        // AI-adjacent rule applies to users too: input is data — strict parse.
        const parsed = ProfileEditSchema.partial().safeParse(patch);
        if (!parsed.success) throw new ActionError({ code: "BAD_REQUEST" });
        // Writes her profiles row directly — edits publish immediately; the
        // first save creates the draft (ADMIN.md §6, DATA.md).
        try {
          await accountApi.saveProfile(session, parsed.data);
        } catch {
          // Missing identity fields on a first save (name/birthDate/gender/city).
          throw new ActionError({ code: "BAD_REQUEST" });
        }
        return { ok: true };
      },
    }),

    // Draft/paused → the moderation queue. Never auto-publishes (hard rule 5).
    submitProfile: defineAction({
      input: z.object({}),
      handler: async (_input, context) => {
        const session = await requireSession(context);
        await accountApi.submitProfile(session);
        return { ok: true };
      },
    }),

    // Merge device-local favorites into the account (called on login/register);
    // returns the merged set so the device can adopt anything synced elsewhere.
    syncFavorites: defineAction({
      input: z.object({ favorites: z.array(z.string().max(120)).max(500) }),
      handler: async ({ favorites }, context) => {
        const session = await requireSession(context);
        const acct = await accountApi.get(session);
        const merged = [...new Set([...acct.favorites, ...favorites])];
        await accountApi.save(session, { favorites: merged });
        return { favorites: merged };
      },
    }),

    addPhoto: defineAction({
      input: z.object({
        // client downscales + re-encodes (EXIF stripped by the canvas re-encode)
        dataUrl: z
          .string()
          .regex(/^data:image\/jpeg;base64,/)
          .max(900_000),
        isPrivate: z.boolean().default(false),
      }),
      handler: async ({ dataUrl, isPrivate }, context) => {
        const session = await requireSession(context);
        // Decode the client's EXIF-stripped JPEG data-URL → bytes → R2 (the
        // data layer owns the upload). base64 → ArrayBuffer.
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await accountApi.addPhoto(session, { bytes: bytes.buffer, contentType: "image/jpeg", isPrivate });
        return { ok: true };
      },
    }),

    removePhoto: defineAction({
      input: z.object({ id: z.string().max(60) }),
      handler: async ({ id }, context) => {
        const session = await requireSession(context);
        await accountApi.removePhoto(session, { id });
        return { ok: true };
      },
    }),

    startSms: defineAction({
      input: z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/) }),
      handler: async ({ phone }, context) => {
        const session = await requireSession(context);
        // Mock: Twilio Verify `start` lands here later (ARCHITECTURE §11).
        await accountApi.save(session, { phone });
        return { ok: true };
      },
    }),

    checkSms: defineAction({
      input: z.object({ code: z.string().regex(/^\d{6}$/) }),
      handler: async (_input, context) => {
        const session = await requireSession(context);
        // Mock: any 6-digit code verifies. Twilio `check` replaces this.
        await accountApi.save(session, { phoneVerifiedAt: new Date().toISOString() });
        return { ok: true };
      },
    }),

    submitId: defineAction({
      input: z.object({}),
      handler: async (_input, context) => {
        const session = await requireSession(context);
        // Documents are NEVER stored here (hard rule 3: toxic waste). The real
        // impl streams EXIF-stripped files to the private R2 bucket; the mock
        // discards them client-side and only records the state transition.
        await accountApi.save(session, {
          idVerification: "pending",
          verificationSubmittedAt: new Date().toISOString(),
          verificationReason: undefined,
        });
        return { ok: true };
      },
    }),

    demoApproveId: defineAction({
      input: z.object({}),
      handler: async (_input, context) => {
        const session = await requireSession(context);
        // Demo-only shortcut for the moderation queue that doesn't exist yet.
        await accountApi.save(session, { idVerification: "approved" });
        return { ok: true };
      },
    }),
  },

  // Messaging (docs/MESSAGING.md). Participation + the client photo-grant rule
  // are enforced in the data layer (mock stand-in for RLS): a caller who isn't
  // a participant gets null back, never another user's thread.
  messaging: {
    // Client taps "Message" on a profile → get-or-create the thread, navigate.
    start: defineAction({
      input: z.object({ profileSlug: z.string().max(120), locale: z.enum(LOCALES) }),
      handler: async ({ profileSlug, locale }, context) => {
        const session = await requireSession(context);
        const thread = await messagingApi.startThread(session, { profileSlug });
        if (!thread) return { href: null as string | null };
        return { href: `/${locale}/messages/${thread.id}/` };
      },
    }),

    // The flagship (UX-PLAN 4.2): a client sends a pre-qualified request card.
    // Every field is a taxonomy value or a snapshotted price — data, never
    // free text she must read. Creates a pending thread; the throttle (data
    // layer) then blocks free-compose until she accepts.
    startRequest: defineAction({
      input: z.object({
        profileSlug: z.string().max(120),
        locale: z.enum(LOCALES),
        service: z.enum(ALL_SERVICES as unknown as [string, ...string[]]),
        duration: z.enum(RATE_DURATIONS),
        priceAtRequest: z.number().int().nonnegative(),
        when: z.enum(REQUEST_WHEN),
        slot: z.string().max(40).optional(),
        note: z.string().max(140).optional(),
        screeningAnswer: z.string().max(140).optional(),
      }),
      handler: async ({ profileSlug, locale, ...request }, context) => {
        const session = await requireSession(context);
        const thread = await messagingApi.startRequest(session, {
          profileSlug,
          request: request as Parameters<typeof messagingApi.startRequest>[1]["request"],
        });
        if (!thread) return { href: null as string | null };
        return { href: `/${locale}/messages/${thread.id}/` };
      },
    }),

    // Professional accepts/declines a pending request (UX-PLAN 4.3). Accept
    // opens the chat + unlocks her private set; decline closes silently.
    respondRequest: defineAction({
      input: z.object({
        threadId: z.string().max(200),
        accept: z.boolean(),
        reply: z.string().max(4000).optional(),
      }),
      handler: async ({ threadId, accept, reply }, context) => {
        const session = await requireSession(context);
        const ok = await messagingApi.respondRequest(session, { threadId, accept, reply });
        if (!ok) throw new ActionError({ code: "BAD_REQUEST" });
        return { ok: true };
      },
    }),

    // Realtime poll (§5) + "viewing = read": marks the other party's messages
    // read, returns only messages newer than `after` + read watermark + flags.
    // Never the professional's private note (client-safe payload).
    thread: defineAction({
      input: z.object({ threadId: z.string().max(200), after: z.string().max(40).optional() }),
      handler: async ({ threadId, after }, context) => {
        const session = await requireSession(context);
        await messagingApi.markRead(session, threadId);
        const view = await messagingApi.poll(session, threadId, after);
        return { view };
      },
    }),

    send: defineAction({
      input: z.object({
        threadId: z.string().max(200),
        kind: z.enum(["text", "photo"]),
        body: z.string().max(4000).optional(),
        // client downscales + re-encodes (EXIF stripped by the canvas re-encode,
        // hard rule 2) — same pipeline as account.addPhoto.
        photo: z
          .string()
          .regex(/^data:image\/jpeg;base64,/)
          .max(900_000)
          .optional(),
      }),
      handler: async (input, context) => {
        const session = await requireSession(context);
        const message = await messagingApi.send(session, input);
        if (!message) throw new ActionError({ code: "BAD_REQUEST" });
        return { message };
      },
    }),

    setMode: defineAction({
      input: z.object({ mode: z.enum(CONVERSATION_MODES) }),
      handler: async ({ mode }, context) => {
        const session = await requireSession(context);
        await messagingApi.setMode(session, mode);
        return { ok: true };
      },
    }),

    // Her screening question (UX-PLAN 4.3) — professional-only, enforced in the
    // data layer. Empty string clears it.
    setScreeningQuestion: defineAction({
      input: z.object({ question: z.string().max(140) }),
      handler: async ({ question }, context) => {
        const session = await requireSession(context);
        await messagingApi.setScreeningQuestion(session, { question });
        return { ok: true };
      },
    }),

    setNote: defineAction({
      input: z.object({ threadId: z.string().max(200), note: z.string().max(500) }),
      handler: async ({ threadId, note }, context) => {
        const session = await requireSession(context);
        await messagingApi.setNote(session, { threadId, note });
        return { ok: true };
      },
    }),

    setPinned: defineAction({
      input: z.object({ threadId: z.string().max(200), pinned: z.boolean() }),
      handler: async ({ threadId, pinned }, context) => {
        const session = await requireSession(context);
        await messagingApi.setPinned(session, { threadId, pinned });
        return { ok: true };
      },
    }),

    // Her per-client photo grant (MESSAGING.md 0.3). Professional-only, silent
    // on revoke, system card on grant — all enforced in the data layer.
    setMediaAllowed: defineAction({
      input: z.object({ threadId: z.string().max(200), allowed: z.boolean() }),
      handler: async ({ threadId, allowed }, context) => {
        const session = await requireSession(context);
        await messagingApi.setMediaAllowed(session, { threadId, allowed });
        return { ok: true };
      },
    }),

    setBlocked: defineAction({
      input: z.object({ threadId: z.string().max(200), blocked: z.boolean() }),
      handler: async ({ threadId, blocked }, context) => {
        const session = await requireSession(context);
        await messagingApi.setBlocked(session, { threadId, blocked });
        return { ok: true };
      },
    }),

    // Contacts CRM — her address book (professional-only, enforced in the data layer).
    addContact: defineAction({
      input: z.object({
        name: z.string().trim().min(1).max(60),
        handle: z.string().trim().max(120).optional(),
        note: z.string().max(500).optional(),
      }),
      handler: async (input, context) => {
        const session = await requireSession(context);
        await messagingApi.addContact(session, input);
        return { ok: true };
      },
    }),

    updateContact: defineAction({
      input: z.object({
        id: z.string().max(60),
        name: z.string().trim().min(1).max(60),
        handle: z.string().trim().max(120).optional(),
        note: z.string().max(500).optional(),
      }),
      handler: async (input, context) => {
        const session = await requireSession(context);
        await messagingApi.updateContact(session, input);
        return { ok: true };
      },
    }),

    removeContact: defineAction({
      input: z.object({ id: z.string().max(60) }),
      handler: async ({ id }, context) => {
        const session = await requireSession(context);
        await messagingApi.removeContact(session, { id });
        return { ok: true };
      },
    }),
  },

  // User-facing reporting (docs/ADMIN.md §7) — feeds the admin Reports queue.
  report: {
    file: defineAction({
      input: z.object({
        targetKind: z.enum(REPORT_TARGETS),
        targetId: z.string().max(200),
        targetLabel: z.string().max(200).optional(),
        profileSlug: z.string().max(120).optional(),
        threadId: z.string().max(200).optional(),
        reason: z.enum(REPORT_REASONS),
        note: z.string().max(1000).optional(),
      }),
      handler: async (input, context) => {
        const session = await requireSession(context);
        await reportsApi.file(session, input);
        return { ok: true };
      },
    }),
  },

  // Admin action tree (fenced in src/actions/admin/**).
  admin,
};
