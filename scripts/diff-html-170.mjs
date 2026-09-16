#!/usr/bin/env node
/**
 * HTML non-regression gate for issue #170 (Astro 5 -> 7 upgrade).
 *
 * The source of truth for compared URLs is `dist/sitemap-0.xml`: every <loc>
 * maps to `<dist>/<path>/index.html` (root -> `<dist>/index.html`). Each page
 * of the post-upgrade build is token-diffed against the pre-upgrade baseline
 * versioned under `artifacts/reviews/170-html-diff/baseline-v5/`.
 *
 * Usage:
 *   node scripts/diff-html-170.mjs [--baseline <dir>] [--dist <dir>]
 *                                  [--sitemap <file>] [--max-diffs <n>]
 * The flags default to the real repo locations and exist mainly to point the
 * script at /tmp fixtures for self-testing.
 *
 * Exit codes:
 *   0  no diff (or only allowlisted diffs)
 *   1  at least one non-allowlisted diff
 *   2  setup error - most commonly: the versioned baseline is missing; also:
 *      dist/ or dist/sitemap-0.xml missing
 *
 * ---------------------------------------------------------------------------
 * MECHANICAL NORMALIZATION ALLOWLIST (applied to BOTH sides before tokenizing,
 * except rule 9 which is baseline-only. Each rule documents WHY it exists.)
 *
 *  1. Asset hash names: /_astro/name.<hash>.<ext> -> /_astro/name.HASH<ext>
 *     WHY: every build re-hashes assets; the hash carries no markup meaning.
 *  2. Inline <script> bodies (no src=, and not application/ld+json) are
 *     replaced by a fixed placeholder.
 *     WHY: Astro 5 and 7 inline different hydration/runtime payloads
 *     (astro-island element definition, astro:load glue, hoisted island
 *     props). That is framework build output, not markup; shipped JS
 *     behaviour is covered by e2e, not here. application/ld+json is
 *     DELIBERATELY kept byte-comparable: it is SEO content produced by
 *     src/utils/schema.ts and must not drift.
 *  3. <astro-island uid="..."> -> uid="ISLAND-UID"
 *     WHY: uid is derived from component + compiler version and changes with
 *     every major. Props and component-url attributes stay compared (they are
 *     a real regression vector).
 *  4. Astro scoped-style hashes: astro-xxxxxxxx -> astro-CID, and attribute
 *     names data-astro-cid-xxx -> astro-cid-CID.
 *     WHY: the scoping hash depends on the compiler version (v5 emits a
 *     class, v7 data-astro-cid-* attributes). Known non-scoped tokens
 *     (astro-island / astro-slot / astro-static-slot) are excluded.
 *  5. <meta name="generator" content="Astro vX.Y.Z"> -> content="Astro-GENERATOR"
 *     WHY: obviously version-dependent. Scoped to the generator meta tag so
 *     literal "Astro vX" in visible article text is NOT masked.
 *  6. All HTML comments are dropped (including Astro's empty <!-- --> island
 *     markers).
 *     WHY: marker comments around islands/slots changed count and order
 *     between majors; they carry no semantics.
 *  7. Text tokens: whitespace collapsed, entities decoded, trimmed.
 *     WHY: the markdown pipeline changed between v5 and v7 - reflowed
 *     whitespace and different escaping of the SAME characters must not
 *     flag. The visible French wording itself MUST remain identical.
 *  8. Tag tokens: attributes sorted (canonical order), self-closing "/" on
 *     tags dropped.
 *     WHY: attribute order carries no semantics in HTML and the two
 *     compilers emit directives in different orders; void-element slash
 *     rendering churned between versions.
 *  9. EXPECTED_CLASS_RENAMES applied to class values in the BASELINE only
 *     (see constant below).
 *
 * KNOWN LIMITATIONS (what this diff can mask):
 * - inline JS behaviour changes (bodies placeholdered) - covered by e2e;
 * - whitespace-only spacing inside inline elements (<span>a</span> vs
 *   <span>a </span>) - collapsed by rule 7;
 * - <pre>/whitespace-sensitive content is compared collapsed, not byte-wise;
 * - HTML comments inside markdown content are ignored (rule 6);
 * - attribute ORDER changes are invisible (rule 8) - only presence/values.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory holding the pre-upgrade capture (mirrors dist/ layout). */
const DEFAULT_BASELINE_DIR = 'artifacts/reviews/170-html-diff/baseline-v5';

/**
 * Tailwind 4 renames, see T6. The baseline was captured BEFORE the source
 * class rename (T5/T6), so the old Tailwind 3 scale names must be mapped to
 * their Tailwind 4 equivalents before comparing against the post-bump dist.
 * Keys are individual classes found in baseline class="..." values.
 * Extend here (and only here) if T6's rename list grows.
 *
 * @type {Map<string, string>}
 */
const EXPECTED_CLASS_RENAMES = new Map([
  // TW3 `shadow-sm` became `shadow-xs`; bare TW3 `shadow` became `shadow-sm`.
  ['shadow-sm', 'shadow-xs'],
  ['shadow', 'shadow-sm'],
  // Same family for radii: bare TW3 `rounded` became `rounded-sm`.
  ['rounded', 'rounded-sm'],
  // TW4 `outline-none` truly removes the outline; `outline-hidden` keeps the
  // v3 forced-colors-safe behavior (see Tailwind 4 upgrade guide) — parity rename.
  ['outline-none', 'outline-hidden'],
]);

/** Pages excluded from the diff (too dynamic to arbitrate mechanically). */
const EXCLUDED_PATHS = new Set([
  '/mes-rdvs/',
  '/reports/latest/',
  '/reports/playwright/',
]);

/** Max diff hunks printed per URL. */
const MAX_DIFFS_PER_URL = 10;

/** Context tokens rendered before/after a changed region. */
const HUNK_CONTEXT = 2;

/**
 * Myers diff depth cap. Normalized pages should be near-identical (small D);
 * a D beyond this means the pages are fundamentally different and the diff is
 * reported as "too different" instead of burning O(D^2) memory on the trace.
 */
const MAX_DIFF_DEPTH = 512;

/** Max rendered length of one hunk excerpt. */
const SNIPPET_MAX = 240;

const INLINE_SCRIPT_PLACEHOLDER = 'INLINE-SCRIPT-BODY';

// ---------------------------------------------------------------------------
// Mechanical normalizations (string level, both sides)
// ---------------------------------------------------------------------------

/**
 * Asset paths under /_astro/: normalize the ENTIRE basename (hash included),
 * keeping only the final extension — Rolldown (v7/Vite 8) renames the shared
 * CSS chunk after a different entry (`a-propos.HASH.css` → `Layout.HASH.css`),
 * and hoisted JS bundles reshuffle too. The extension is preserved so a CSS↔JS
 * reference swap still flags. (The hash sits in the middle of the basename and
 * must NOT leak into the placeholder.)
 */
const ASTRO_ASSET_RE =
  /(\/_astro\/)([^"'\s<>()]{1,200}?)((?:\.[A-Za-z0-9]{1,4})+)(?=["'\s<>()])/g;

const ASTRO_ISLAND_UID_RE = /(<astro-island\b[^>]*?\buid=")[^"]*(")/g;

/**
 * Scoped-style hash. Excludes known framework tokens that merely start with
 * "astro-" and must stay comparable (astro-island, astro-slot, ...).
 */
const ASTRO_SCOPED_HASH_RE =
  /\bastro-(?!island\b|slot\b|static-slot\b)[A-Za-z0-9]{6,}\b/g;

const INLINE_SCRIPT_RE = /(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi;

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const GENERATOR_META_RE =
  /(<meta\b[^>]*\bname=["']generator["'][^>]*\bcontent=["'])Astro v[\d.]+[^"']*(["'])/gi;

/**
 * Apply every string-level normalization from the allowlist (rules 1-6).
 * Class renames (rule 9) happen later, at token level, baseline-side only.
 *
 * @param {string} html raw document
 * @returns {string} normalized document
 */
function normalizeHtml(html) {
  let out = html;

  // Rule 2 first: placeholder inline script bodies BEFORE stripping comments,
  // otherwise a "<!--" inside a script body could make the comment regex eat
  // across the </script> boundary and swallow real markup.
  out = out.replace(INLINE_SCRIPT_RE, (_m, open, attrs, body) => {
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) {
      return open + body + '</script>'; // kept: SEO payload must not drift
    }
    if (body.trim() === '') return open + '</script>';
    return `<script${attrs}>${INLINE_SCRIPT_PLACEHOLDER}</script>`;
  });

  // Rule 6: drop all comments (Astro empty markers changed between majors).
  out = out.replace(HTML_COMMENT_RE, '');

  // Rule 3: island uid is compiler-derived.
  out = out.replace(ASTRO_ISLAND_UID_RE, '$1ISLAND-UID$2');

  // Rule 5: generator meta (only the meta tag, not visible text).
  out = out.replace(GENERATOR_META_RE, '$1Astro-GENERATOR$2');

  // Rule 4: scoped-style hashes (class form; attr form handled in parseAttrs).
  out = out.replace(ASTRO_SCOPED_HASH_RE, 'astro-CID');

  // Rule 1: asset paths (basename + hash normalized, extension preserved).
  out = out.replace(
    ASTRO_ASSET_RE,
    (_m, pre, _base, ext) => `${pre}ASSET-FILE${ext}`,
  );

  return out;
}

// ---------------------------------------------------------------------------
// Tokenizer (rule 7, 8, 9)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ecirc: 'ê',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  euro: '€',
  deg: '°',
  copy: '©',
  middot: '·',
};

/**
 * Decode entities in TEXT tokens only. WHY: v5 and v7 escape the same
 * characters differently in places; the decoded characters must compare equal.
 */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // fromCodePoint throws beyond the Unicode range; keep the raw entity
      // instead of crashing the whole run on a hostile/pasted entity.
      return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Apply rule 9 (Tailwind 4 renames, see T6) to one baseline class value.
 * Applied per whole class token so `shadow-sm` never double-maps to `shadow`.
 * Tailwind variant prefixes (`hover:`, `focus:`, `md:`, …) chain BEFORE the
 * utility name and follow the same rename — the site ships `focus:rounded` —
 * so the part after the last ':' is what gets mapped.
 */
function mapBaselineClassValue(value) {
  return value
    .split(/\s+/)
    .map(cls => {
      const sep = cls.lastIndexOf(':');
      const prefix = sep === -1 ? '' : cls.slice(0, sep + 1);
      const utility = sep === -1 ? cls : cls.slice(sep + 1);
      return prefix + (EXPECTED_CLASS_RENAMES.get(utility) ?? utility);
    })
    .join(' ');
}

/** Parse the attribute section of a tag into canonical "name=value" strings. */
function parseAttrs(str, isBaseline) {
  const attrs = [];
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]*)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    let name = m[1].toLowerCase();
    let value = m[2] ?? m[3] ?? m[4] ?? '';
    if (name.startsWith('data-astro-cid-')) name = 'astro-cid-CID'; // rule 4
    // Decode entities in attribute values too: astro 7 escapes `&` uniformly
    // (`&amp;`) where v5 emitted it raw (image URLs, titles) — the decoded
    // values must compare equal.
    value = decodeEntities(value.replace(/\s+/g, ' ').trim());
    if (name === 'class') {
      value = isBaseline ? mapBaselineClassValue(value) : value;
    }
    attrs.push(`${name}=${value}`);
  }
  return attrs.sort(); // rule 8: attribute order carries no semantics
}

/**
 * Tokenize a normalized document into a flat sequence:
 *   '<tag', 'name=value' (sorted), '>', '</tag>', text.
 *
 * Assumption (documented): raw '<' only starts tags because text-level '<'
 * is entity-escaped in valid HTML output; a stray '<' that does not parse as
 * a tag is skipped identically on both sides.
 *
 * @param {string} html normalized document
 * @param {boolean} isBaseline apply EXPECTED_CLASS_RENAMES to class attrs
 * @returns {string[]}
 */
function tokenizeHtml(html, isBaseline) {
  const tokens = [];
  const n = html.length;
  let i = 0;

  const pushText = raw => {
    const text = decodeEntities(raw.replace(/\s+/g, ' ').trim());
    if (text !== '') {
      tokens.push(text);
    } else if (raw.trim() === '' && raw !== '') {
      // Whitespace-only text node between tags: keep a sentinel so losing the
      // space between two inline elements (the compressHTML regression class
      // the spec assigns this gate to arbitrate) flags instead of collapsing.
      tokens.push('WS');
    }
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      // Stray comment (normalization should have removed them): skip safely.
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      const decl = html.slice(lt, end === -1 ? n : end + 1);
      tokens.push(decl.replace(/\s+/g, ' ').toLowerCase());
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Find the tag's closing '>' while respecting quoted attribute values.
    let j = lt + 1;
    let quote = null;
    for (; j < n; j++) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
    }
    const raw = html.slice(lt + 1, j === n ? n : j);
    i = j === n ? n : j + 1;

    if (raw.startsWith('/')) {
      tokens.push(`</${raw.slice(1).trim().toLowerCase()}>`);
      continue;
    }
    const nameMatch = raw.match(/^[A-Za-z][A-Za-z0-9:._-]*/);
    if (!nameMatch) continue; // malformed '<' in text: skipped on both sides
    tokens.push(`<${nameMatch[0].toLowerCase()}`);
    for (const attr of parseAttrs(raw.slice(nameMatch[0].length), isBaseline)) {
      tokens.push(attr);
    }
    tokens.push('>'); // rule 8: '/>' normalized to '>' (void-element churn)
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Token diff (Myers O(ND), no dependencies)
// ---------------------------------------------------------------------------

/**
 * @returns {Array<{t: 0|1|2, ai?: number, bi?: number}>} 0=equal, 1=del from
 * a, 2=ins from b — or null when the edit distance exceeds MAX_DIFF_DEPTH.
 */
function diffTokens(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === m && a.every((tok, idx) => tok === b[idx])) return []; // fast path

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace = [];
  let foundD = -1;

  for (let d = 0; d <= max; d++) {
    if (d > MAX_DIFF_DEPTH) return null; // too different: bail out safely
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]; // insertion (move down from k+1)
      } else {
        x = v[offset + k - 1] + 1; // deletion (move right from k-1)
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
    if (foundD >= 0) break;
  }

  // Backtrack the trace into an edit script.
  const ops = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d--) {
    const vPrev = trace[d]; // snapshot taken before pass d == state after d-1
    const k = x - y;
    const prevK =
      k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1])
        ? k + 1
        : k - 1;
    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ t: 0, ai: x - 1, bi: y - 1 });
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push({ t: 2, bi: y - 1 });
      y--;
    } else {
      ops.push({ t: 1, ai: x - 1 });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ t: 0, ai: x - 1, bi: y - 1 });
    x--;
    y--;
  }
  while (x > 0) {
    ops.push({ t: 1, ai: x - 1 });
    x--;
  }
  while (y > 0) {
    ops.push({ t: 2, bi: y - 1 });
    y--;
  }
  return ops.reverse();
}

/** Group the edit script into hunks with HUNK_CONTEXT equal tokens around. */
function buildHunks(a, b, ops) {
  const ranges = [];
  let cur = null;
  ops.forEach((op, idx) => {
    if (op.t === 0) return;
    const start = Math.max(0, idx - HUNK_CONTEXT);
    const end = Math.min(ops.length - 1, idx + HUNK_CONTEXT);
    if (cur && start <= cur.end + 1) {
      cur.end = Math.max(cur.end, end);
    } else {
      cur = { start, end };
      ranges.push(cur);
    }
  });

  return ranges.map(r => {
    const render = side => {
      const parts = [];
      for (let idx = r.start; idx <= r.end; idx++) {
        const op = ops[idx];
        const tok =
          op.t === 0
            ? side === 'a'
              ? a[op.ai]
              : b[op.bi]
            : op.t === 1
              ? side === 'a'
                ? a[op.ai]
                : undefined
              : side === 'b'
                ? b[op.bi]
                : undefined;
        if (tok === undefined) continue;
        if (op.t !== 0) parts.push(side === 'a' ? `«${tok}»` : `«${tok}»`);
        else parts.push(tok);
      }
      let s = parts.join(' ');
      if (s.length > SNIPPET_MAX) s = `${s.slice(0, SNIPPET_MAX)}…`;
      return s;
    };
    return { baseline: render('a'), dist: render('b') };
  });
}

// ---------------------------------------------------------------------------
// URL extraction / path mapping
// ---------------------------------------------------------------------------

/**
 * Normalize a URL's pathname for reporting/exclusion: always ends with '/'
 * (matches the trailing-slash convention, ADR-013).
 */
function pathnameOf(loc) {
  let p = new URL(loc).pathname;
  if (!p.endsWith('/')) p += '/';
  return p;
}

/** Extract every <loc> URL from the sitemap (regex is enough: flat urlset). */
function extractSitemapUrls(xml) {
  const urls = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1]);
  return urls;
}

/**
 * Map a sitemap <loc> to its file path relative to the dist root:
 *   https://omf-therapie.fr/            -> index.html
 *   https://omf-therapie.fr/blog/foo/   -> blog/foo/index.html
 */
function urlToRelPath(loc) {
  const url = new URL(loc);
  const raw = url.pathname;
  let pathname = raw;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed escape sequence: fall back to the raw pathname.
  }
  // Decoding can resurrect separators and dot-segments (%2F..%2F survives URL
  // normalization): reject anything whose decoded form grows segments or
  // contains traversal, rather than letting join() resolve outside dist/.
  if (
    pathname.includes('\0') ||
    pathname.split('/').length !== raw.split('/').length ||
    /(^|\/)%2e%2e(\/|$)/i.test(raw) ||
    /(^|\/)\.{1,2}(\/|$)/.test(pathname)
  ) {
    return null;
  }
  pathname = pathname.replace(/\/+$/, '');
  return pathname === '' ? 'index.html' : `${pathname}/index.html`;
}

/**
 * Baseline page universe: every index.html in the capture, as a trailing-slash
 * pathname (inverse of urlToRelPath). Root capture -> '/', blog/foo/index.html
 * -> '/blog/foo/'.
 */
async function listBaselinePages(dir) {
  const out = [];
  async function walk(current, prefix) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(join(current, e.name), `${prefix}${e.name}/`);
      } else if (e.name === 'index.html') {
        out.push(prefix);
      }
    }
  }
  await walk(dir, '/');
  return out;
}

/** Every /_astro/... asset reference in a rendered page (attribute values). */
function extractAstroRefs(html) {
  const out = [];
  const re = /\/_astro\/[^"'\s<>()]+/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[0]);
  return out;
}

// ---------------------------------------------------------------------------
// Allowlist of accepted residual diffs
// ---------------------------------------------------------------------------

/**
 * Residual (post-normalization) diffs that were reviewed and accepted.
 * A hunk is allowlisted when SOME entry matches both the URL pathname and the
 * hunk text. Keep this list short and documented — it is the audit trail for
 * accepted churn.
 *
 * @type {Array<{url: RegExp, hunk: RegExp}>}
 */
const ALLOWLISTED_DIFFS = [
  // Astro 7's slugger keeps a trailing dash for the trailing `?` of the
  // heading « Comment choisir son thérapeute ? » — the anchor id gains a `-`.
  // No internal links target this anchor (no TOC on the page); documented in
  // the PR as a deep-link change for external referrers.
  {
    url: /^\/blog\/deconstruire-tabous-therapie\/$/,
    baseline: /«id=comment-choisir-son-thérapeute»/,
    dist: /«id=comment-choisir-son-thérapeute-»/,
  },
  // Markdown processor fix: v7 emits the correct closing guillemet (`… »`
  // instead of `… «`) in two list items — a visible micro-correction.
  {
    url: /^\/blog\/renforcer-communication-couple\/$/,
    baseline: /«[^»]*“[^»]*»/,
    dist: /«[^»]*”[^»]*»/,
  },
  // Astro 7 emits an extra whitespace text node between </body> and </html>
  // (document-tail formatting — outside any content, zero rendering impact).
  // The WS sentinel made this visible on all 27 URLs; reviewed and accepted.
  {
    url: /.*/,
    baseline: /^WS <\/body> <\/html>( WS)?$/,
    dist: /^WS <\/body> «WS» <\/html>( WS)?$/,
  },
];

function isAllowlisted(urlPath, hunk) {
  // Both sides must match the documented old/new forms: matching the baseline
  // text alone would green-light any unrelated diff that happens to sit near
  // quoted text within the hunk's context window.
  return ALLOWLISTED_DIFFS.some(
    entry =>
      entry.url.test(urlPath) &&
      entry.baseline.test(hunk.baseline) &&
      entry.dist.test(hunk.dist),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const { values } = parseArgs({
    options: {
      baseline: { type: 'string' },
      dist: { type: 'string' },
      sitemap: { type: 'string' },
      'max-diffs': { type: 'string' },
    },
  });

  const distDir = values.dist ?? join(repoRoot, 'dist');
  const baselineDir = values.baseline ?? join(repoRoot, DEFAULT_BASELINE_DIR);
  const sitemapPath = values.sitemap ?? join(distDir, 'sitemap-0.xml');
  const maxPerUrl = Number.parseInt(values['max-diffs'] ?? '10', 10);

  // Setup errors exit 2: nothing was compared, the run itself is invalid.
  if (!(await pathExists(baselineDir))) {
    console.error(
      `ERROR: baseline not found at ${relative(repoRoot, baselineDir)}\n` +
        'Restore the versioned baseline (artifacts/reviews/170-html-diff/baseline-v5/).',
    );
    process.exit(2);
  }
  if (!(await pathExists(sitemapPath))) {
    console.error(
      `ERROR: sitemap not found at ${relative(repoRoot, sitemapPath)}\n` +
        'Build dist/ first (or pass --dist/--sitemap).',
    );
    process.exit(2);
  }

  const sitemapXml = await readFile(sitemapPath, 'utf8');
  // URL universe = union of the new build's sitemap URLs and every index.html
  // captured in the baseline: a baseline-only page means the page (or route)
  // disappeared from the new build — that must FAIL, not silently shrink
  // coverage. Reading only the new sitemap made removal structurally
  // invisible (recall finding, PR #173 review).
  const locs = extractSitemapUrls(sitemapXml);
  const newPathnames = locs.map(pathnameOf);
  const baselinePathnames = await listBaselinePages(baselineDir);
  const allPathnames = [...new Set([...newPathnames, ...baselinePathnames])];
  const excluded = allPathnames.filter(p => EXCLUDED_PATHS.has(p));
  // Baseline-only entries are synthesized so the shared loop handles removals
  // like any other URL (baseline HTML present + dist missing = loud failure).
  const entries = allPathnames
    .filter(p => !excluded.includes(p))
    .map(p => {
      const loc = locs.find(u => pathnameOf(u) === p);
      return loc
        ? { urlPath: p, relPath: urlToRelPath(loc) }
        : {
            urlPath: p,
            relPath:
              p === '/' ? 'index.html' : `${p.replace(/\/+$/, '')}/index.html`,
          };
    });

  /** @type {Array<{url: string, hunks: Array<object>}>} */
  const urlDiffs = [];
  const missingBaseline = [];
  const ssrSkipped = [];
  let allowlistedCount = 0;

  for (const { urlPath, relPath } of entries) {
    if (relPath === null) {
      urlDiffs.push({
        url: urlPath,
        hunks: [
          {
            baseline: '(sitemap <loc>)',
            dist: 'UNMAPPABLE after decode (traversal/separator payload) — refusing to read',
          },
        ],
      });
      continue;
    }
    const baselinePath = join(baselineDir, relPath);
    const distPath = join(distDir, relPath);
    // Belt and braces: even a legitimate-looking path must stay contained.
    if (relative(distDir, distPath).startsWith('..')) {
      urlDiffs.push({
        url: urlPath,
        hunks: [
          {
            baseline: '(sitemap <loc>)',
            dist: 'PATH ESCAPES DIST — refusing to read',
          },
        ],
      });
      continue;
    }

    let baselineHtml = null;
    try {
      baselineHtml = await readFile(baselinePath, 'utf8');
    } catch {
      // No prerendered HTML in the baseline capture.
    }

    let distHtml = null;
    try {
      distHtml = await readFile(distPath, 'utf8');
    } catch {
      // No prerendered HTML in the current build.
    }

    if (baselineHtml === null && distHtml === null) {
      // SSR-only page (prerender = false): never prerendered on either side of
      // the upgrade, so there is no static artifact to diff. Runtime behavior
      // is covered by the SSR smoke checklist instead.
      ssrSkipped.push(urlPath);
      continue;
    }

    if (baselineHtml === null) {
      missingBaseline.push(`${urlPath} (${relative(repoRoot, baselinePath)})`);
      continue;
    }

    if (distHtml === null) {
      urlDiffs.push({
        url: urlPath,
        hunks: [
          {
            baseline: '(file present in baseline)',
            dist: 'FILE MISSING IN DIST — page/route removed from the new build (or dropped from its sitemap)?',
          },
        ],
      });
      continue;
    }

    const a = tokenizeHtml(normalizeHtml(baselineHtml), true);
    const b = tokenizeHtml(normalizeHtml(distHtml), false);
    const ops = diffTokens(a, b);

    const hunks =
      ops === null
        ? [
            {
              baseline: `(${a.length} tokens, first: ${a.slice(0, 5).join(' ')})`,
              dist: `(${b.length} tokens, first: ${b.slice(0, 5).join(' ')}) [sequences too different for token diff — review manually]`,
            },
          ]
        : buildHunks(a, b, ops);

    const accepted = hunks.filter(h => isAllowlisted(urlPath, h));
    allowlistedCount += accepted.length;
    const remaining = hunks.filter(h => !isAllowlisted(urlPath, h));
    if (remaining.length > 0) urlDiffs.push({ url: urlPath, hunks: remaining });

    // Dangling asset references: normalization tolerates chunk renames, so a
    // broken /_astro/ reference (unstyled page, dead hydration island) would
    // otherwise compare equal. The baseline capture kept only HTML — check the
    // dist side, where a broken reference actually ships.
    for (const ref of extractAstroRefs(distHtml)) {
      if (!existsSync(join(distDir, ref))) {
        urlDiffs.push({
          url: urlPath,
          hunks: [
            {
              baseline: '(asset present in baseline build)',
              dist: `DANGLING ASSET REFERENCE: ${ref} not found under dist/`,
            },
          ],
        });
      }
    }
  }

  // Report.
  let failed = false;
  if (missingBaseline.length > 0) {
    console.error(
      `ERROR: baseline file(s) missing for ${missingBaseline.length} URL(s):\n` +
        missingBaseline.map(p => `  - ${p}`).join('\n') +
        '\nRun the baseline capture first.',
    );
    process.exit(2);
  }

  for (const { url, hunks } of urlDiffs) {
    failed = true;
    console.log(`\n== ${url} (${hunks.length} diff hunk(s))`);
    for (const [i, hunk] of hunks.slice(0, maxPerUrl).entries()) {
      console.log(`  ${i + 1}. B: ${hunk.baseline}`);
      console.log(`     D: ${hunk.dist}`);
    }
    if (hunks.length > maxPerUrl) {
      console.log(`  … ${hunks.length - maxPerUrl} more hunk(s) not shown`);
    }
  }

  const totalHunks = urlDiffs.reduce((acc, d) => acc + d.hunks.length, 0);
  const summary =
    `${entries.length - ssrSkipped.length} URLs compared, ${excluded.length} excluded ` +
    `(${[...EXCLUDED_PATHS].join(', ')}), ${ssrSkipped.length} SSR-only skipped` +
    (ssrSkipped.length > 0 ? ` (${ssrSkipped.join(', ')})` : '') +
    `, ${totalHunks} diff hunk(s) on ${urlDiffs.length} URL(s), ` +
    `${allowlistedCount} allowlisted`;
  console.log(`\nSummary: ${summary}`);

  if (failed) {
    console.log('FAIL: non-allowlisted markup diffs remain — review above.');
    process.exit(1);
  }
  console.log('OK: 0 non-allowlisted diffs.');
  process.exit(0);
}

main().catch(err => {
  console.error(`ERROR: unexpected failure: ${err?.stack ?? err}`);
  process.exit(2);
});
