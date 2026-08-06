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
        strategy: ['url', 'cookie', 'baseLocale'],
        // /admin is locale-less: no 'url' strategy there, or the middleware
        // 307s /admin → /{locale}/admin (redirect loop with our un-prefixing
        // redirect). Cookie (the NL/EN toggle) decides, falling back to en.
        routeStrategies: [{ match: '/admin{/*}?', strategy: ['cookie', 'baseLocale'] }],
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
