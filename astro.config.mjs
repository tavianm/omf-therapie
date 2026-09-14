import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://omf-therapie.fr',
  trailingSlash: 'ignore',
  output: 'static',
  // Astro 6+ flipped the default: compressHTML is now true out of the box.
  // Pin it explicitly so the shipped markup stays byte-stable across the
  // Astro 5 -> 7 bump (issue #170) regardless of future default changes.
  compressHTML: true,
  adapter: netlify(),
  integrations: [
    react(),
    sitemap({
      filter: (page) => ![
        'https://omf-therapie.fr/Tarifs/',
        'https://omf-therapie.fr/Services/',
        'https://omf-therapie.fr/About/',
        'https://omf-therapie.fr/Process/',
        'https://omf-therapie.fr/Formations/',
      ].includes(page),
    }),
  ],
  vite: {
    // Tailwind v4 via the official Vite plugin (replaces the old Astro
    // integration). Base styles are still managed in src/index.css via
    // `@import "tailwindcss"` — no automatic base injection anymore.
    plugins: [tailwindcss()],
    // Pre-bundle every bare specifier (and hydration sub-path) reachable from
    // a client island. An allowlist naming only the deps seen in one repro
    // lets the same failure class resurface one page later: a late-discovered
    // dep triggers a global re-optimization and each load 504s the island's
    // module ("Outdated Optimize Dep") until the cache settles. Sweep rule:
    // any bare import under src/components (islands, admin, blog, nav, …) or
    // src/hooks must appear below — no automated drift guard exists yet (CI
    // never boots the dev server).
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-dom/client',
        'react-hot-toast',
        'lucide-react',
        'framer-motion',
        'html-react-parser',
      ],
    },
    // Keep Vite optimizations from the old config where applicable
    build: {
      rollupOptions: {
        output: {
          // Vite 8 (Rolldown) silently ignores the `manualChunks` function
          // form — the Sentry SDK split moved to Rolldown's `advancedChunks`
          // groups API. Same intent as the pre-#170 manualChunks: split
          // @sentry/browser into its own cacheable chunk so the ~70KB SDK
          // stays out of the per-layout script hash and remains cached across
          // deploys. We only special-case Sentry; single-importer vendor
          // modules are inlined regardless.
          advancedChunks: {
            groups: [
              {
                name: 'sentry',
                test: /node_modules[\\/]@sentry[\\/]browser/,
              },
            ],
          },
        },
      },
    },
    // Legacy react-router-dom / react-helmet-async aliases removed: the orphaned
    // Footer.tsx and SEO.tsx that imported them were deleted in #86 (dead code
    // from the pre-Astro SPA migration; all pages use components/layout/Footer.astro).
    // The /dev/null alias was non-portable (resolved on Windows MSYS, failed on
    // Linux CI's tsc under astro check — the latent ts(2307) surfaced once
    // typecheck became a blocking gate).
    ssr: {
      // Keep these as external so Vite/Rollup doesn't try to bundle them.
      // nodemailer is CommonJS; googleapis is enormous and has CJS/ESM interop issues.
      external: ['nodemailer', 'googleapis'],
    },
  },
});
