/** JSON backend for articles (docs/API.md). */
import { z } from 'zod';
import {
  ArticleListParamsSchema,
  ArticleSchema,
  type ArticlesApi,
} from '@/app/models/article';
import raw from './articles.json';

const ALL = z
  .array(ArticleSchema)
  .parse(raw)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

export const articlesApi: ArticlesApi = {
  async list(params = {}) {
    const q = ArticleListParamsSchema.parse(params);
    return { items: ALL.slice(0, q.limit) };
  },

  async bySlug(slug) {
    return ALL.find((a) => a.slug === slug) ?? null;
  },
};
