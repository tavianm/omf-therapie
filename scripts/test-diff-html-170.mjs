#!/usr/bin/env node
/**
 * Deterministic fail-closed tests for the #170 HTML non-regression gate.
 *
 * These fixtures deliberately avoid the local-only production baseline, so
 * they can run in CI after the build. Each mutation must make
 * diff-html-170.mjs exit 1 and name its specific failure mode.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const gate = join(repoRoot, 'scripts/diff-html-170.mjs');
const siteUrl = 'https://example.test';

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function sitemap(paths) {
  return `<?xml version="1.0"?><urlset>${paths
    .map(path => `<url><loc>${siteUrl}${path}</loc></url>`)
    .join('')}</urlset>`;
}

async function fixture(root, { baseline, dist, sitemapPaths }) {
  const baselineDir = join(root, 'baseline');
  const distDir = join(root, 'dist');
  for (const [path, html] of Object.entries(baseline)) {
    await write(join(baselineDir, path), html);
  }
  for (const [path, html] of Object.entries(dist)) {
    await write(join(distDir, path), html);
  }
  await write(join(distDir, 'sitemap-0.xml'), sitemap(sitemapPaths));
  return { baselineDir, distDir };
}

async function runCase(root, name, data, expected) {
  const { baselineDir, distDir } = await fixture(join(root, name), data);
  let output = '';
  let status = 0;
  try {
    output = execFileSync(
      process.execPath,
      [gate, '--baseline', baselineDir, '--dist', distDir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    status = error.status ?? -1;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  if (status !== 1 || !output.includes(expected)) {
    throw new Error(
      `${name}: expected exit 1 containing ${JSON.stringify(expected)}, ` +
        `got exit ${status}\n${output}`,
    );
  }
  console.log(`PASS ${name}: exit 1 includes ${JSON.stringify(expected)}`);
}

const root = await mkdtemp(join(tmpdir(), 'diff-html-170-'));
try {
  await runCase(
    root,
    'baseline-only-route-removal',
    {
      baseline: {
        'index.html': '<main>Accueil</main>',
        'removed/index.html': '<main>Route conservée</main>',
      },
      dist: { 'index.html': '<main>Accueil</main>' },
      sitemapPaths: ['/'],
    },
    'FILE MISSING IN DIST — page/route removed',
  );

  await runCase(
    root,
    'inter-inline-whitespace-loss',
    {
      baseline: { 'index.html': '<p><span>Bonjour</span> <span>monde</span></p>' },
      dist: { 'index.html': '<p><span>Bonjour</span><span>monde</span></p>' },
      sitemapPaths: ['/'],
    },
    '«WS»',
  );

  await runCase(
    root,
    'dangling-astro-asset',
    {
      baseline: { 'index.html': '<script src="/_astro/missing.js"></script>' },
      dist: { 'index.html': '<script src="/_astro/missing.js"></script>' },
      sitemapPaths: ['/'],
    },
    'DANGLING ASSET REFERENCE: /_astro/missing.js',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('OK: 3 fail-closed HTML gate cases verified.');
