/** Article domain model (docs/API.md). */
import { z } from 'zod';

export const ArticleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  minutes: z.number().int().positive(),
  featured: z.boolean(),
  publishedAt: z.iso.datetime(),
});
export type Article = z.infer<typeof ArticleSchema>;

export const ArticleListParamsSchema = z.object({
  limit: z.number().int().min(0).max(50).default(10),
});
export type ArticleListParams = z.input<typeof ArticleListParamsSchema>;

/** Contract every backend implements (json today, Drizzle/Supabase later). */
export interface ArticlesApi {
  list(params?: ArticleListParams): Promise<{ items: Article[] }>;
  bySlug(slug: string): Promise<Article | null>;
}
