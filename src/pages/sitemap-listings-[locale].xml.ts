import type { APIRoute } from 'astro';
import { profilesApi } from '@/app/api/profiles';
import { isLocale } from '@/lib/i18n';
import { CITIES, LISTING_CATEGORIES, SERVICES } from '@/lib/taxonomy';

const SERVICES_BY_CATEGORY = Object.fromEntries(
  Object.entries(SERVICES).map(([cat, list]) => [cat, new Set<string>(list)]),
) as Record<string, Set<string>>;

/**
 * Per-locale listings sitemap: home, search, stats, city hubs, category and
 * category×city pages (only combinations with results — no empty indexables).
 * lastmod = newest profile in the page's result set (real freshness signal).
 */
export const GET: APIRoute = async ({ params, url }) => {
  const locale = params.locale;
  if (!isLocale(locale)) return new Response(null, { status: 404 });

  const { items: profiles } = await profilesApi.list({ limit: 60 });
  const lastmodOf = (filter: (p: (typeof profiles)[number]) => boolean): string | undefined => {
    const dates = profiles.filter(filter).map((p) => p.createdAt);
    return dates.length ? dates.sort().at(-1)!.slice(0, 10) : undefined;
  };
  const globalLastmod = lastmodOf(() => true);

  const entries: Array<{ path: string; lastmod?: string }> = [
    { path: `/${locale}/`, lastmod: globalLastmod },
    { path: `/${locale}/search/`, lastmod: globalLastmod },
    { path: `/${locale}/stats/`, lastmod: globalLastmod },
  ];

  // Profile pages (hard rule 8: every public page type is in the sitemap).
  for (const p of profiles) {
    entries.push({ path: `/${locale}/profile/${p.slug}/`, lastmod: p.createdAt.slice(0, 10) });
  }

  for (const city of CITIES) {
    const lastmod = lastmodOf((p) => p.city === city.slug);
    if (lastmod) entries.push({ path: `/${locale}/${city.slug}/`, lastmod });
  }

  for (const cat of LISTING_CATEGORIES) {
    const filter = cat.filter as { meetingType?: 'incall' | 'outcall'; serviceCategory?: string };
    const matches = (p: (typeof profiles)[number]) =>
      filter.meetingType
        ? p.meetingTypes.includes(filter.meetingType)
        : p.services.some((s) => (SERVICES_BY_CATEGORY[filter.serviceCategory!] ?? new Set()).has(s));
    const catLastmod = lastmodOf(matches);
    if (!catLastmod) continue;
    entries.push({ path: `/${locale}/${cat.slugs[locale]}/`, lastmod: catLastmod });
    for (const city of CITIES) {
      const lastmod = lastmodOf((p) => matches(p) && p.city === city.slug);
      if (lastmod) entries.push({ path: `/${locale}/${cat.slugs[locale]}/${city.slug}/`, lastmod });
    }
  }

  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${url.origin}${e.path}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
