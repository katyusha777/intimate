/**
 * Server actions (CLAUDE.md conventions): Zod-validated, run inside the
 * Cloudflare Worker — API keys never reach the client.
 */
import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { ProfileEditSchema } from "@/app/models/account";
import { accountApi } from "@/app/api/account";
import { callsApi } from "@/app/api/calls";
import { messagingApi } from "@/app/api/messaging";
import { reportsApi } from "@/app/api/reports";
import { sessionApi } from "@/app/api/session";
import { env } from "cloudflare:workers";
import { startPhoneVerify, checkPhoneVerify } from "@/lib/twilio";
import { bustProfiles, type CacheKv } from "@/lib/page-cache";
import { rateLimit } from "@/lib/rate-limit";
import { dataUrlToJpegBytes, stripJpegDataUrl } from "@/lib/jpeg-strip";
import { mintIceServers } from "@/lib/turn";
import { CONVERSATION_MODES, REPORT_REASONS, REPORT_TARGETS } from "@/lib/taxonomy";
// The one sanctioned cross-fence import: the action registry wires in admin.
import { admin } from "@/actions/admin";
import {
  ALL_SERVICES,
  CALL_MODES,
  LOCALES,
  RATE_DURATIONS,
  REQUEST_WHEN,
} from "@/lib/taxonomy";

const cacheKv = (): CacheKv | undefined =>
  (env as unknown as Record<string, unknown>).SESSION as CacheKv | undefined;

const turnSecret = (): string | undefined =>
  (env as unknown as Record<string, string | undefined>).TURN_SECRET;

/** Best-effort client IP for rate-limit keys (Cloudflare always sets this). */
const clientIp = (context: { request: Request }): string =>
  context.request.headers.get("cf-connecting-ip") ?? "unknown";

/** Shared spam wall for authenticated actions — throws TOO_MANY_REQUESTS.
 *  `failClosedInProd` denies (instead of the dev-friendly open) when the KV
 *  binding is missing in production — use it for money/brute-force walls
 *  (auth, SMS) so a KV hiccup can't silently disable them. */
async function requireUnderLimit(name: string, key: string, max: number, windowS = 3600, failClosedInProd = false) {
  if (!(await rateLimit(cacheKv(), name, key, max, windowS, failClosedInProd))) {
    throw new ActionError({ code: "TOO_MANY_REQUESTS", message: "try again later" });
  }
}

/** Auth-input validators (normalise once at the trust boundary — L1): trim +
 *  lowercase every email so uniqueness/enumeration/owner checks can't be split
 *  by case; one shared password floor so the three password paths can't drift. */
const emailField = z.string().trim().toLowerCase().email();
const passwordField = z.string().min(8); // was 6; still under Supabase's ceiling

/** QA whitelist: numbers in SMS_TEST_NUMBERS (comma-separated E.164) bypass ALL
 *  SMS limits + the phone-in-use check + Twilio entirely — the code `000000`
 *  verifies. For testing only; keep the list tiny. */
const isTestNumber = (phone: string): boolean =>
  ((env as unknown as Record<string, string | undefined>).SMS_TEST_NUMBERS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).includes(phone);

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
        email: emailField,
        password: passwordField,
        role: z.enum(["advertiser", "client"]),
        locale: z.enum(LOCALES),
      }),
      handler: async ({ email, password, role, locale }, context) => {
        // Spam wall BEFORE any account creation (SECURITY.md §5). Turnstile
        // removed 2026-08-09: error 600010 false-positives were blocking real
        // registrations — the IP rate limit is the bot wall now.
        await requireUnderLimit("register-ip", clientIp(context), 10);
        try {
          const { needsConfirmation, emailExists } = await sessionApi.register(context, { email, password, role });
          // Existing email (#13): a distinct signal so the modal can show the
          // "account already exists → reset / support" message.
          if (emailExists) return { href: null, needsConfirmation: false, emailExists: true };
          if (needsConfirmation) return { href: null, needsConfirmation: true, emailExists: false };
          // Auto-login (Supabase "Confirm email" OFF): a session exists now, so
          // send the advertiser STRAIGHT into onboarding — no email stop, no
          // dashboard detour. Clients go to their account home.
          const dest = role === 'advertiser' ? `/${locale}/account/setup/` : `/${locale}/account/`;
          return { href: dest, needsConfirmation: false, emailExists: false };
        } catch (e) {
          throw new ActionError({ code: "BAD_REQUEST", message: (e as Error).message });
        }
      },
    }),

    login: defineAction({
      input: z.object({
        email: emailField,
        password: z.string().min(1),
        locale: z.enum(LOCALES),
      }),
      handler: async ({ email, password, locale }, context) => {
        // Credential-stuffing / brute-force wall (SECURITY.md). Fails CLOSED in
        // prod if KV is missing — an auth wall that silently opens is worse than
        // a brief 429. Supabase's own limiter is the second layer.
        await requireUnderLimit("login-ip", clientIp(context), 30, 3600, true);
        const session = await sessionApi.signIn(context, { email, password });
        if (!session) throw new ActionError({ code: "UNAUTHORIZED" });
        return { href: `/${locale}/account/` };
      },
    }),

    // Send a password-reset email. Always returns ok (never reveal if the
    // address exists) — the honest "if that email exists, we sent a link" copy.
    requestReset: defineAction({
      input: z.object({ email: emailField }),
      handler: async ({ email }, context) => {
        // Two walls: per-IP (mail-bomb source) and per-email (a victim's inbox
        // can't be flooded regardless of source IP). Reset stays anti-enumeration
        // (always returns ok), so the limit never leaks existence either.
        await requireUnderLimit("reset-ip", clientIp(context), 10);
        await requireUnderLimit("reset-email", email, 5);
        await sessionApi.requestPasswordReset(context, { email });
        return { ok: true };
      },
    }),

    // Set a new password for the recovery session (from the emailed link).
    setPassword: defineAction({
      input: z.object({ password: passwordField, locale: z.enum(LOCALES) }),
      handler: async ({ password, locale }, context) => {
        const ok = await sessionApi.setPassword(context, { password });
        if (!ok) throw new ActionError({ code: "UNAUTHORIZED" });
        return { href: `/${locale}/account/` };
      },
    }),

    // Change email (confirmation link to the NEW address) — settings (#6).
    changeEmail: defineAction({
      input: z.object({ email: emailField }),
      handler: async ({ email }, context) => {
        await requireSession(context);
        const { ok, error } = await sessionApi.changeEmail(context, { email });
        if (!ok) throw new ActionError({ code: "BAD_REQUEST", message: error ?? "failed" });
        return { ok: true };
      },
    }),

    // Change password after re-verifying the current one — settings (#6).
    changePassword: defineAction({
      input: z.object({ currentPassword: z.string().min(1), newPassword: passwordField }),
      handler: async ({ currentPassword, newPassword }, context) => {
        const session = await requireSession(context);
        // The re-auth does a real signInWithPassword — brute-forceable by a
        // hijacked session otherwise. Fail closed in prod (M3).
        await requireUnderLimit("changepw", session.accountId, 10, 3600, true);
        const { ok, error } = await sessionApi.changePassword(context, { currentPassword, newPassword });
        if (!ok) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: error === "wrong_current_password" ? "settings_pw_wrong" : (error ?? "failed"),
          });
        }
        return { ok: true };
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
        if (!parsed.success) {
          // Surface the human message only — never the technical field path
          // ("birthDate: …") which reads as a bug to a non-technical advertiser.
          throw new ActionError({ code: "BAD_REQUEST", message: parsed.error.issues[0].message });
        }
        // Writes her profiles row directly — edits publish immediately; the
        // first save creates the draft (ADMIN.md §6, DATA.md).
        try {
          await accountApi.saveProfile(session, parsed.data);
        } catch {
          // Missing identity fields on a first save (name/birthDate/gender/city).
          throw new ActionError({ code: "BAD_REQUEST", message: "Fill in name, date of birth, gender and city first." });
        }
        await bustProfiles(cacheKv()); // her public page changed → drop the edge cache
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

    // Mis-registered client → advertiser (the dashboard banner). Self-service:
    // client and advertiser are peers (no privilege boundary — RLS is
    // ownership-based), so no admin needed. The switch is one accounts column
    // (session.role reads it); a short-lived cookie bridges the DB read lag AND
    // busts the 60s session memo (new Cookie header) so the next page sees her
    // as an advertiser immediately.
    becomeAdvertiser: defineAction({
      input: z.object({ locale: z.enum(LOCALES) }),
      handler: async ({ locale }, context) => {
        const session = await requireSession(context);
        if (session.role === 'client') {
          await accountApi.setAccountType(session.accountId, 'advertiser');
          context.cookies.set('became_advertiser', '1', {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: import.meta.env.PROD,
            maxAge: 1800,
          });
        }
        return { ok: true, href: `/${locale}/account/setup/` };
      },
    }),

    // Owner pause/unpause of a live profile (settings toggle).
    setPaused: defineAction({
      input: z.object({ paused: z.boolean() }),
      handler: async ({ paused }, context) => {
        const session = await requireSession(context);
        await accountApi.setPaused(session, paused);
        return { ok: true };
      },
    }),

    // GDPR self-service (items.md #6/#7): flag the request; admins fulfil
    // (deletion needs approval, export is sent by hand — stated in the UI).
    requestGdpr: defineAction({
      input: z.object({ kind: z.enum(['deletion', 'data']) }),
      handler: async ({ kind }, context) => {
        const session = await requireSession(context);
        const now = new Date().toISOString();
        await accountApi.save(
          session,
          kind === 'deletion' ? { deletionRequestedAt: now } : { dataRequestedAt: now },
        );
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
        // Decode → RE-STRIP metadata server-side (hard rule 2: never trust the
        // client's canvas re-encode alone — a crafted POST keeps EXIF/GPS) → R2.
        // Malformed base64 (Zod only checks the prefix) → clean 400, not a 500.
        let bytes: ArrayBuffer;
        try {
          bytes = dataUrlToJpegBytes(dataUrl);
        } catch {
          throw new ActionError({ code: "BAD_REQUEST", message: "invalid image" });
        }
        await accountApi.addPhoto(session, { bytes, isPrivate });
        await bustProfiles(cacheKv());
        return { ok: true };
      },
    }),

    removePhoto: defineAction({
      input: z.object({ id: z.string().max(60) }),
      handler: async ({ id }, context) => {
        const session = await requireSession(context);
        await accountApi.removePhoto(session, { id });
        await bustProfiles(cacheKv());
        return { ok: true };
      },
    }),

    startSms: defineAction({
      input: z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/) }),
      handler: async ({ phone }, context) => {
        const session = await requireSession(context);
        // QA whitelist: skip every wall + Twilio for a test number.
        if (!isTestNumber(phone)) {
          // Abuse walls (items.md #12) BEFORE any Twilio spend: a number verified
          // on another account is dead here, and both the target number and the
          // requesting account are rate-limited (each send costs real money).
          if (await accountApi.phoneInUse(phone, session.accountId)) {
            throw new ActionError({ code: 'CONFLICT', message: 'phone already in use' });
          }
          const kv = cacheKv();
          // Each send costs real money (Twilio) → fail CLOSED in prod if KV is
          // gone, so a binding hiccup can't open the toll-fraud tap.
          if (
            !(await rateLimit(kv, 'sms-num', phone, 3, 3600, true)) ||
            !(await rateLimit(kv, 'sms-acct', session.accountId, 5, 3600, true))
          ) {
            throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'try again later' });
          }
          // Twilio Verify sends the code; we stash the (still-unverified) number so
          // checkSms knows which To to verify against. phoneVerifiedAt gates trust.
          try {
            await startPhoneVerify(phone);
          } catch (e) {
            console.error('[sms] start failed', (e as Error).message);
            throw new ActionError({ code: 'BAD_REQUEST' });
          }
        }
        await accountApi.save(session, { phone });
        return { ok: true };
      },
    }),

    checkSms: defineAction({
      input: z.object({ code: z.string().regex(/^\d{6}$/) }),
      handler: async ({ code }, context) => {
        const session = await requireSession(context);
        const { phone } = await accountApi.get(session);
        if (!phone) throw new ActionError({ code: 'BAD_REQUEST' });
        let approved = false;
        if (isTestNumber(phone)) {
          // QA whitelist: no limits, no Twilio — 000000 verifies.
          approved = code === '000000';
        } else {
          // Brute-force wall on code guesses (items.md #12). 5/hr against a 6-digit
          // code — Twilio's own attempt cap is the backstop; fail CLOSED in prod.
          if (!(await rateLimit(cacheKv(), 'sms-check', session.accountId, 5, 3600, true))) {
            throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'try again later' });
          }
          // Re-check at the wall: the number may have been verified elsewhere
          // between start and check.
          if (await accountApi.phoneInUse(phone, session.accountId)) {
            throw new ActionError({ code: 'CONFLICT', message: 'phone already in use' });
          }
          try {
            approved = await checkPhoneVerify(phone, code);
          } catch (e) {
            console.error('[sms] check failed', (e as Error).message);
            throw new ActionError({ code: 'BAD_REQUEST' });
          }
        }
        if (!approved) throw new ActionError({ code: 'BAD_REQUEST', message: 'invalid code' });
        await accountApi.save(session, { phoneVerifiedAt: new Date().toISOString() });
        return { ok: true };
      },
    }),

    submitId: defineAction({
      // Client re-encodes to JPEG via canvas (EXIF/GPS stripped, hard rule 2)
      // before it leaves the device; same shape + cap as account.addPhoto. ID
      // ONLY — the selfie-with-code was dropped 2026-08-10 (product decision).
      input: z.object({
        doc: z.string().regex(/^data:image\/jpeg;base64,/).max(2_000_000),
      }),
      handler: async ({ doc }, context) => {
        const session = await requireSession(context);
        try {
          // Streams to the private EU bucket + records hashes + flags pending
          // (hard rule 3). NEVER log the contents — only a generic failure.
          await accountApi.submitVerification(session, {
            // Decode + re-strip server-side (hard rule 2) — the ID must never
            // carry EXIF/GPS even if a crafted client skipped the canvas
            // re-encode. A malformed body throws → caught below → 400.
            docs: [{ bytes: dataUrlToJpegBytes(doc) }],
          });
        } catch (e) {
          console.error("[verify] submit failed:", (e as Error).message);
          throw new ActionError({ code: "BAD_REQUEST" });
        }
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
        await requireUnderLimit("msg-start", session.accountId, 30);
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
        service: z.enum(ALL_SERVICES as unknown as [string, ...string[]]).optional(),
        duration: z.enum(RATE_DURATIONS).optional(),
        priceAtRequest: z.number().int().nonnegative().optional(),
        when: z.enum(REQUEST_WHEN),
        slot: z.string().max(40).optional(),
        note: z.string().max(140).optional(),
        screeningAnswer: z.string().max(140).optional(),
      }),
      handler: async ({ profileSlug, locale, ...request }, context) => {
        const session = await requireSession(context);
        await requireUnderLimit("msg-request", session.accountId, 20);
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
        await requireUnderLimit("msg-send", session.accountId, 60);
        // Re-strip metadata server-side (hard rule 2): chat photos are stored
        // inline as data-URLs and re-served to the other party — a crafted client
        // could otherwise deliver a GPS-tagged image. Malformed base64 → 400, not
        // a 500 + spurious error capture. ponytail: chat photos still bypass
        // R2/the /media gate (stored inline); move them to the addPhoto→R2
        // pipeline with thread-scoped gating if inline storage ever bites.
        let clean = input;
        if (input.kind === "photo" && input.photo) {
          try {
            clean = { ...input, photo: stripJpegDataUrl(input.photo) };
          } catch {
            throw new ActionError({ code: "BAD_REQUEST", message: "invalid image" });
          }
        }
        const message = await messagingApi.send(session, clean);
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
      input: z.object({ threadId: z.string().max(200), blocked: z.boolean(), del: z.boolean().optional() }),
      handler: async ({ threadId, blocked, del }, context) => {
        const session = await requireSession(context);
        await messagingApi.setBlocked(session, { threadId, blocked, del });
        return { ok: true };
      },
    }),

    // Delete-later for an already-blocked thread (items.md #1).
    hideThread: defineAction({
      input: z.object({ threadId: z.string().max(200) }),
      handler: async ({ threadId }, context) => {
        const session = await requireSession(context);
        await messagingApi.hideThread(session, { threadId });
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
        // Per-account throttle: addContact by email is an account-existence
        // oracle (b71aa8af) — cap probing to a human rate.
        await requireUnderLimit("contact-add", session.accountId, 30);
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

    // Invite links (VIDEO-CALLING.md §5) — professional-only; the claim itself
    // runs server-side in the /c/[token] route (page SSR, not an action).
    mintInvite: defineAction({
      input: z.object({ name: z.string().trim().max(60).optional(), locale: z.enum(LOCALES) }),
      handler: async ({ name, locale }, context) => {
        const session = await requireSession(context);
        await requireUnderLimit("invite-mint", session.accountId, 20);
        const invite = await messagingApi.mintInvite(session, { name });
        if (!invite) throw new ActionError({ code: "BAD_REQUEST" });
        return { invite, url: `${context.url.origin}/${locale}/c/${invite.token}` };
      },
    }),

    revokeInvite: defineAction({
      input: z.object({ id: z.string().max(60) }),
      handler: async ({ id }, context) => {
        const session = await requireSession(context);
        await messagingApi.revokeInvite(session, { id });
        return { ok: true };
      },
    }),
  },

  // Calls (docs/VIDEO-CALLING.md §6). Client initiation is impossible end to
  // end: the data layer requires session.profileId, and call_sessions has no
  // browser write path (0010) — the DB CHECK is the last wall.
  call: {
    start: defineAction({
      input: z.object({ threadId: z.string().max(200), mode: z.enum(CALL_MODES) }),
      handler: async ({ threadId, mode }, context) => {
        const session = await requireSession(context);
        // Ring-bomb wall (VIDEO-CALLING.md §9): cap call starts per professional.
        await requireUnderLimit("call-start", session.accountId, 30);
        const call = await callsApi.start(session, { threadId, mode });
        if (call === 'busy') throw new ActionError({ code: "CONFLICT", message: "busy" });
        if (!call) throw new ActionError({ code: "BAD_REQUEST" });
        // Caller side forces relay when TURN is live: her candidates never
        // contain her address — the client can only ever learn the relay's.
        const ice = await mintIceServers(turnSecret(), call.id, new Date());
        return { call, iceServers: ice.iceServers, relayOnly: ice.relayAvailable };
      },
    }),

    get: defineAction({
      input: z.object({ callId: z.string().max(60) }),
      handler: async ({ callId }, context) => {
        const session = await requireSession(context);
        const call = await callsApi.get(session, callId);
        if (!call) throw new ActionError({ code: "NOT_FOUND" });
        return { call };
      },
    }),

    accept: defineAction({
      input: z.object({ callId: z.string().max(60) }),
      handler: async ({ callId }, context) => {
        const session = await requireSession(context);
        const ok = await callsApi.accept(session, callId);
        if (!ok) throw new ActionError({ code: "BAD_REQUEST" });
        // Client side keeps policy 'all' — direct or relay, whichever wins.
        const ice = await mintIceServers(turnSecret(), callId, new Date());
        return { iceServers: ice.iceServers, relayOnly: false };
      },
    }),

    decline: defineAction({
      input: z.object({ callId: z.string().max(60) }),
      handler: async ({ callId }, context) => {
        const session = await requireSession(context);
        await callsApi.decline(session, callId);
        return { ok: true };
      },
    }),

    end: defineAction({
      input: z.object({
        callId: z.string().max(60),
        reason: z.enum(['hangup', 'timeout', 'failed']),
      }),
      handler: async ({ callId, reason }, context) => {
        const session = await requireSession(context);
        await callsApi.end(session, { callId, reason });
        return { ok: true };
      },
    }),

    beat: defineAction({
      input: z.object({ callId: z.string().max(60) }),
      handler: async ({ callId }, context) => {
        const session = await requireSession(context);
        await callsApi.beat(session, callId);
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
        await requireUnderLimit("report-file", session.accountId, 20);
        await reportsApi.file(session, input);
        return { ok: true };
      },
    }),
  },

  // Admin action tree (fenced in src/actions/admin/**).
  admin,
};
