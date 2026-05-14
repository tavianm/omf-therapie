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
    // Legacy components (Footer.tsx, SEO.tsx) imported react-router-dom / react-helmet-async
    // which are no longer installed. Mark them as external to prevent dev-server scan errors.
    resolve: {
      alias: {
        'react-router-dom': '/dev/null',
        'react-helmet-async': '/dev/null',
      },
    },
    optimizeDeps: {
      exclude: ['react-router-dom', 'react-helmet-async'],
    },
    ssr: {
      // Keep these as external so Vite/Rollup doesn't try to bundle them.
      // nodemailer is CommonJS; googleapis is enormous and has CJS/ESM interop issues.
      external: ['nodemailer', 'googleapis'],
    },
  },
});
