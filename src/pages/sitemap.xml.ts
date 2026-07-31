import type { APIRoute } from 'astro';
import { LOCALES } from '@/lib/taxonomy';

/** Sitemap index (SEO.md §1) — one listings sitemap per locale; profiles join when profile pages exist. */
export const GET: APIRoute = ({ url }) => {
  const sitemaps = LOCALES.map(
    (l) => `  <sitemap><loc>${url.origin}/sitemap-listings-${l}.xml</loc></sitemap>`,
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps}\n</sitemapindex>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
