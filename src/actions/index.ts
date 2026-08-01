/**
 * Server actions (CLAUDE.md conventions): Zod-validated, run inside the
 * Cloudflare Worker — API keys never reach the client.
 */
import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";
import { z as zod } from "zod";
import { env } from "cloudflare:workers";
import { getAiSearchConfig, OPENROUTER_URL } from "@/lib/ai";
import { ProfileEditSchema } from "@/app/models/account";
import { accountApi } from "@/app/api/account";
import { messagingApi } from "@/app/api/messaging";
import { sessionApi } from "@/app/api/session";
import { CONVERSATION_MODES } from "@/lib/taxonomy";
import {
  ALL_SERVICES,
  CITIES,
  GENDERS,
  LOCALES,
  MEETING_TYPES,
} from "@/lib/taxonomy";

/** Actions run with the request's cookie jar — sessions resolve per request. */
async function requireSession(context: { cookies: Parameters<typeof sessionApi.fromCookies>[0] }) {
  const session = await sessionApi.fromCookies(context.cookies);
  if (!session) throw new ActionError({ code: "UNAUTHORIZED" });
  return session;
}

const CITY_SLUGS = CITIES.map((c) => c.slug);

/**
 * What the model may return — strictly our taxonomy. AI output is DATA, never
 * instructions (hard rule 7): parsed, Zod-validated, invalid fields dropped.
 */
const AiFiltersSchema = zod.object({
  city: zod.enum(CITY_SLUGS as [string, ...string[]]).optional(),
  genders: zod.array(zod.enum(GENDERS)).optional(),
  services: zod
    .array(zod.enum(ALL_SERVICES as unknown as [string, ...string[]]))
    .optional(),
  meetingType: zod.enum(MEETING_TYPES).optional(),
  priceMin: zod.number().int().min(0).optional(),
  priceMax: zod.number().int().min(0).optional(),
  onlineOnly: zod.boolean().optional(),
});

const PROMPT = `You translate a free-text search on an adult-services directory (Netherlands) into structured filters. The user may write in Dutch, English or German.

Return ONLY a JSON object — no prose, no code fences — with any of these keys (omit a key when the query says nothing about it):
- "city": one of ${JSON.stringify(CITY_SLUGS)}
- "genders": array from ${JSON.stringify(GENDERS)} ("girl/woman/lady"→female, "trans/shemale/tgirl"→trans_woman)
- "services": array from ${JSON.stringify(ALL_SERVICES)} (pick the closest matches; "blowjob"→oral_without_condom or oral_with_condom, "GFE/girlfriend"→girlfriend_experience)
- "meetingType": "incall" (client visits: private visit, privéontvangst) or "outcall" (provider travels: escort, hotel/home visit)
- "priceMin"/"priceMax": integers in EUR ("under 150"→priceMax 150, "cheap"→priceMax 120)
- "onlineOnly": true when they want someone available right now

Match city names loosely (Den Haag = The Hague = 's-Gravenhage → "den-haag"). Never invent values outside the lists.`;

/** Drop invalid fields instead of failing — mirrors profileListParamsFromUrl. */
function lenientParse(raw: unknown): zod.infer<typeof AiFiltersSchema> {
  const first = AiFiltersSchema.safeParse(raw);
  if (first.success) return first.data;
  if (typeof raw !== "object" || raw === null) return {};
  const loose: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
  };
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") delete loose[key];
  }
  const retry = AiFiltersSchema.safeParse(loose);
  return retry.success ? retry.data : {};
}

export const server = {
  aiSearch: defineAction({
    input: z.object({
      query: z.string().trim().min(2).max(200),
      locale: z.enum(LOCALES),
    }),
    handler: async ({ query, locale }, context) => {
      // Abuse guard: 60 req/hour per IP, counted in the SESSION KV (skipped
      // when the binding is absent in dev). ponytail: KV read-caching (~60s)
      // makes short windows unenforceable — an hourly budget converges and
      // cuts sustained abuse; first-minute bursts slip. The real burst guard
      // is a zone rate-limiting rule on /_actions/* at launch (INFRASTRUCTURE).
      const kv = (env as unknown as Record<string, unknown>).SESSION as
        | {
            get(k: string): Promise<string | null>;
            put(
              k: string,
              v: string,
              o?: { expirationTtl: number },
            ): Promise<void>;
          }
        | undefined;
      if (kv) {
        const bucket = Math.floor(Date.now() / 3_600_000);
        const key = `aisearch-rl:${context.clientAddress ?? "unknown"}:${bucket}`;
        const used = Number(await kv.get(key)) || 0;
        if (used >= 60) throw new Error("rate limited");
        await kv.put(key, String(used + 1), { expirationTtl: 7_200 });
      }

      const cfg = getAiSearchConfig();
      let filters: zod.infer<typeof AiFiltersSchema> = {};
      for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
        try {
          const res = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${(env as unknown as Record<string, string>).OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://intimate.nl",
              "X-Title": "Intimate",
            },
            body: JSON.stringify({
              model: cfg.model,
              temperature: cfg.temperature,
              max_tokens: cfg.maxTokens,
              response_format: { type: "json_object" },
              provider: { order: cfg.providerOrder, allow_fallbacks: true },
              // Single user turn: DeepInfra's DeepSeek template ignores long
              // system messages — instructions must ride with the query.
              messages: [
                {
                  role: "user",
                  content: `${PROMPT}\n\nSearch query: "${query}"`,
                },
              ],
            }),
            signal: AbortSignal.timeout(cfg.timeoutMs),
          });
          if (!res.ok) throw new Error(`upstream ${res.status}`);

          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const text = (data.choices?.[0]?.message?.content ?? "{}").replace(
            /^```(?:json)?\s*|\s*```$/g,
            "",
          );
          try {
            filters = lenientParse(JSON.parse(text));
          } catch {
            filters = {};
          }
          if (Object.keys(filters).length > 0) break; // provider flake → one retry
        } catch (err) {
          // timeout / upstream error: retry once, then surface (client falls
          // back to plain text search)
          if (attempt === cfg.maxAttempts - 1) throw err;
        }
      }

      // Build the localized listing URL server-side — the client just navigates.
      const sp = new URLSearchParams();
      for (const g of filters.genders ?? []) sp.append("genders", g);
      for (const s of filters.services ?? []) sp.append("services", s);
      if (filters.meetingType) sp.set("visit", filters.meetingType);
      if (filters.priceMin !== undefined)
        sp.set("priceMin", String(filters.priceMin));
      if (filters.priceMax !== undefined)
        sp.set("priceMax", String(filters.priceMax));
      if (filters.onlineOnly) sp.set("online", "1");
      const qs = sp.toString();
      const href = `/${locale}/search/${filters.city ? `${filters.city}/` : ""}${qs ? `?${qs}` : ""}`;

      return { href, filters };
    },
  }),

  auth: {
    register: defineAction({
      input: z.object({
        email: z.string().email(),
        password: z.string().min(6), // accepted, unused — mock backend
        role: z.enum(["advertiser", "client"]),
        locale: z.enum(LOCALES),
      }),
      handler: async ({ email, role, locale }, context) => {
        await sessionApi.register(context.cookies, { email, role });
        return { href: `/${locale}/account/` };
      },
    }),

    login: defineAction({
      input: z.object({
        email: z.string().email(),
        password: z.string().min(1),
        locale: z.enum(LOCALES),
      }),
      handler: async ({ email, locale }, context) => {
        await sessionApi.signIn(context.cookies, { email });
        return { href: `/${locale}/account/` };
      },
    }),

    logout: defineAction({
      input: z.object({ locale: z.enum(LOCALES) }),
      handler: async ({ locale }, context) => {
        await sessionApi.signOut(context.cookies);
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
        await accountApi.save(session, { profileOverride: parsed.data });
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
      }),
      handler: async ({ dataUrl }, context) => {
        const session = await requireSession(context);
        const acct = await accountApi.get(session);
        if (acct.extraPhotos.length >= 8) throw new ActionError({ code: "BAD_REQUEST" });
        await accountApi.save(session, { extraPhotos: [...acct.extraPhotos, dataUrl] });
        return { ok: true };
      },
    }),

    removePhoto: defineAction({
      input: z.object({
        /** base = index in the ORIGINAL profile.photos array; extra = index in extraPhotos. */
        kind: z.enum(["base", "extra"]),
        index: z.number().int().min(0),
      }),
      handler: async ({ kind, index }, context) => {
        const session = await requireSession(context);
        const acct = await accountApi.get(session);
        if (kind === "base") {
          await accountApi.save(session, {
            removedPhotos: [...new Set([...acct.removedPhotos, index])],
          });
        } else {
          const extras = acct.extraPhotos.filter((_, i) => i !== index);
          await accountApi.save(session, { extraPhotos: extras });
        }
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
        await accountApi.save(session, { idVerification: "pending" });
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
  },
};
