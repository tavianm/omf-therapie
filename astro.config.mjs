import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://omf-therapie.fr',
  trailingSlash: 'ignore',
  output: 'static',
  adapter: netlify(),
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }), // We manage base styles in src/index.css
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
    // Keep Vite optimizations from the old config where applicable
    build: {
      rollupOptions: {
        output: {
          // Function form: the object form above ('react-vendor', 'motion',
          // 'ui', 'sentry') is silently ignored for Astro's hoisted client
          // scripts (Astro runs its own Rollup pass for them), so none of the
          // named chunks were ever emitted. The function form is invoked for
          // every module and reliably splits @sentry/browser into its own
          // cacheable chunk — keeping the ~70KB SDK out of the per-layout
          // script hash so it stays cached across deploys. We only special-case
          // Sentry here; the other vendor hints above are left as documentation
          // of intent (single-importer modules are inlined regardless).
          manualChunks: (id) => {
            if (id.includes('node_modules/@sentry/browser')) {
              return 'sentry';
            }
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
