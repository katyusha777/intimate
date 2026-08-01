/**
 * Server actions (CLAUDE.md conventions): Zod-validated, run inside the
 * Cloudflare Worker — API keys never reach the client.
 */
import { defineAction } from "astro:actions";
import { z } from "astro:schema";
import { z as zod } from "zod";
import { env } from "cloudflare:workers";
import { getAiSearchConfig, OPENROUTER_URL } from "@/lib/ai";
import {
  ALL_SERVICES,
  CITIES,
  GENDERS,
  LOCALES,
  MEETING_TYPES,
} from "@/lib/taxonomy";

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
};
