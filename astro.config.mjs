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
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'motion': ['framer-motion'],
            'ui': ['lucide-react'],
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
