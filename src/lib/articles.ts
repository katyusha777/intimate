/**
 * Article loader — the one place that reads the `articles` content collection,
 * so the locale filter, newest-first sort, and slug lookup live together.
 * Used by the home shelf, the /blog index + reader, and the sitemap.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '@/lib/taxonomy';

export type ArticleEntry = CollectionEntry<'articles'>;

/** All articles for a locale, newest first. */
export async function articlesForLocale(locale: Locale): Promise<ArticleEntry[]> {
  const items = await getCollection('articles', (e) => e.data.locale === locale);
  return items.sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

/** One article by locale + shared slug, or null. */
export async function articleBySlug(locale: Locale, slug: string): Promise<ArticleEntry | null> {
  const items = await getCollection(
    'articles',
    (e) => e.data.locale === locale && e.data.slug === slug,
  );
  return items[0] ?? null;
}
