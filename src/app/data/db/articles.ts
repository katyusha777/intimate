/**
 * Drizzle articles backend (docs/API.md). Editorial stubs — public read only,
 * no admin CRUD yet. Seeds the bundled set once (guarded by row presence) so
 * the surface is populated; real content management replaces the seed later.
 */
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { articles } from '@/db/schema';
import { ArticleListParamsSchema, ArticleSchema, type Article, type ArticlesApi } from '@/app/models/article';
import raw from '@/app/data/json/articles.json';

const SEED = z.array(ArticleSchema).parse(raw);
type Row = typeof articles.$inferSelect;
const toArticle = (r: Row): Article => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt,
  minutes: r.minutes,
  featured: r.featured,
  publishedAt: r.publishedAt.toISOString(),
});

async function ensureSeed(d: Db): Promise<void> {
  if ((await d.select({ id: articles.id }).from(articles).limit(1)).length) return;
  await d
    .insert(articles)
    .values(
      SEED.map((a) => ({
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        minutes: a.minutes,
        featured: a.featured,
        publishedAt: new Date(a.publishedAt),
      })),
    )
    .onConflictDoNothing();
}

export function makeArticlesApi(db: () => Db): ArticlesApi {
  return {
    async list(params = {}) {
      const q = ArticleListParamsSchema.parse(params);
      await ensureSeed(db());
      const rows = await db().select().from(articles).orderBy(desc(articles.publishedAt)).limit(q.limit);
      return { items: rows.map(toArticle) };
    },
    async bySlug(slug) {
      await ensureSeed(db());
      const [row] = await db().select().from(articles).where(eq(articles.slug, slug)).limit(1);
      return row ? toArticle(row) : null;
    },
  };
}
