#!/usr/bin/env node
/**
 * Minimal static server for dist/ — pa11y audit scaffolding.
 *
 * The Netlify adapter does not implement `astro preview`, and auditing the
 * PROD site (the historical behavior) compares production to itself. This
 * server makes the local build auditable: `A11Y_BASE_URL=http://localhost:4322
 * node scripts/run-a11y-audit.mjs`. Trailing-slash paths resolve to
 * <path>/index.html (static build output); MIME types cover what pa11y needs
 * to render (CSS for contrast checks, JS for hydration).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'dist');
const PORT = Number(process.env.PORT ?? 4322);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname).replace(/\/+$/, '');
    if (rel.includes('..')) {
      res.writeHead(400).end('bad path');
      return;
    }
    const candidates = rel === '' ? ['index.html'] : [`${rel}/index.html`, rel];
    for (const candidate of candidates) {
      const file = path.join(ROOT, candidate);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) {
        const body = await readFile(file);
        res.writeHead(200, {
          'content-type':
            MIME[path.extname(file)] ?? 'application/octet-stream',
        });
        res.end(body);
        return;
      }
    }
    // Static build: the 404 page is prerendered — serve it with its status.
    const notFound = await readFile(path.join(ROOT, '404.html')).catch(
      () => null,
    );
    res
      .writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      .end(notFound ?? 'not found');
  } catch {
    res.writeHead(500).end('server error');
  }
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}/`);
});
