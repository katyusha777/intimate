/**
 * Content collections (Astro content layer). Editorial articles live as
 * markdown-in-git, one file per locale under src/content/articles/{locale}/.
 * Entry id is `${locale}/${slug}` — the reader route reads it via getEntry.
 *
 * Why markdown, not the DB: author-written, rarely-changing, public-read,
 * i18n-by-file content is Astro's job, not Postgres'. No admin CRUD exists;
 * add a DB back the day non-dev editors need a CMS.
 * ponytail: markdown collection, revisit if non-dev editors ever need a CMS.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  // id = `${locale}/${slug}` (default id is the basename, which collides
  // across locales that share a slug — one locale would silently overwrite).
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/articles',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: ({ image }) =>
    z.object({
      /** Locale of this file — also the first segment of the entry id. */
      locale: z.enum(['nl', 'en', 'de']),
      /** Shared across locales; the URL is /{locale}/blog/{slug}/. */
      slug: z.string(),
      title: z.string(),
      /** Card text + fallback meta description. */
      excerpt: z.string(),
      /** Estimated reading time, minutes. */
      minutes: z.number().int().positive(),
      /** Exactly one article per locale is featured (drives the home hero). */
      featured: z.boolean().default(false),
      publishedAt: z.coerce.date(),
      hero: image(),
      heroAlt: z.string(),
      /** Optional <title>/description overrides; else derived from title/excerpt. */
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional(),
    }),
});

export const collections = { articles };
