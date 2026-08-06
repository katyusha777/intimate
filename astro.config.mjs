// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true },
  vite: {
    plugins: [
      tailwindcss(),
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        // Locale comes from the URL prefix — every page lives under /{locale}/.
        // 'cookie' only ever decides on locale-less routes (/admin, /auth):
        // the url strategy wins first wherever a prefix exists.
        strategy: ['url', 'cookie', 'baseLocale'],
        urlPatterns: [
          {
            pattern: '/:path(.*)?',
            localized: [
              ['nl', '/nl/:path(.*)?'],
              ['en', '/en/:path(.*)?'],
              ['de', '/de/:path(.*)?'],
            ],
          },
        ],
      }),
    ],
  },
});
