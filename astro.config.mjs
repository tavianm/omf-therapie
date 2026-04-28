import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://omf-therapie.fr',
  trailingSlash: 'always',
  output: 'hybrid',
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
  },
});
