#!/usr/bin/env node
/**
 * Falsification runner — issue #170 acceptance gates (SC1–SC15 command rows).
 *
 * Follows the v2 contract established in #153/revue #154 (scripts/run-falsify.mjs),
 * adapted to command-based gates instead of vitest suites — the #170 spec's
 * criteria are mechanical gates (audit, greps, build), not unit tests:
 *
 *   - every mutation is CRITERION-SPECIFIC and COMPILING: an exact-match string
 *     substitution on the config/lockfile/source line implementing one SC,
 *     applied only when the anchor occurs EXACTLY ONCE (stale anchor aborts
 *     the row — mutations can never silently no-op);
 *   - a PASS CONTROL (un-mutated run of the check) must be green before the
 *     mutated run is admitted, and the mutated run must exit non-zero — a
 *     check that cannot fail is rejected as tautological;
 *   - sources are restored byte-for-byte after every row (sha256 pinned), so
 *     the artifact's `head` identifies the exact implementation state.
 *
 * Usage: node scripts/run-falsify-170.mjs
 * Writes: artifacts/reviews/170-falsify.json + 170-falsify.md
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = resolve(REPO, 'artifacts/reviews/170-falsify.json');
const OUT_MD = resolve(REPO, 'artifacts/reviews/170-falsify.md');
const RUNNER_ID = 'run-falsify-170/2';

const ANSI =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/**
 * Rows: one SC gate each. `mutation` = { file, anchor, replacement } applied
 * with an exactly-once guarantee; `check` = the gate command; `expect` states
 * the semantic failure being exercised.
 */
const ROWS = [
  {
    sc_id: 'SC2',
    check: 'npm audit --omit=dev --audit-level=high',
    expect: 'a critical astro@5.x in the prod tree must fail the audit gate',
    mutation: {
      file: 'package-lock.json',
      anchor: '"node_modules/astro": {\n      "version": "7.3.2",',
      replacement: '"node_modules/astro": {\n      "version": "5.18.2",',
    },
  },
  {
    sc_id: 'SC4',
    check:
      'test -f src/content.config.ts && ! grep -q "type: \'content\'" src/content.config.ts && grep -q "astro/zod" src/content.config.ts',
    expect:
      'a z import regressed to astro:content (v7 removed it) must fail the legacy check',
    mutation: {
      file: 'src/content.config.ts',
      anchor: "import { z } from 'astro/zod';",
      replacement: "import { z } from 'astro:content';",
    },
  },
  {
    sc_id: 'SC11',
    check: "grep -q 'compressHTML: true' astro.config.mjs",
    expect: 'the pin being flipped to false must fail the config check',
    mutation: {
      file: 'astro.config.mjs',
      anchor: 'compressHTML: true,',
      replacement: 'compressHTML: false,',
    },
  },
  {
    sc_id: 'SC12',
    check:
      'node -e "const [x,y]=process.argv[1].replace(/^v/,\'\').split(\'.\').map(Number); process.exit(x===22&&y>=12?0:1)" "$(cat .nvmrc)" && ! grep -q NODE_VERSION netlify.toml && test "$(grep -c \'node-version-file\' .github/workflows/ci.yml)" = "2"',
    expect: 'a Node pin below the 22.12 engine floor must fail the pin check',
    mutation: {
      file: '.nvmrc',
      anchor: 'v22.23.2',
      replacement: 'v22.11.0',
    },
  },
  {
    sc_id: 'SC13',
    check: "grep -q 'audit-level=high' .github/workflows/ci.yml",
    expect: 'removing the CI audit step must fail the workflow check',
    mutation: {
      file: '.github/workflows/ci.yml',
      anchor: '        run: npm audit --omit=dev --audit-level=high\n',
      replacement: '        run: echo "audit step removed"\n',
    },
  },
  {
    sc_id: 'SC15',
    check:
      "grep -A1 '\"node_modules/nodemailer\"' package-lock.json | grep -q '9\\.1\\.'",
    expect:
      'a nodemailer regression to the vulnerable 9.0.3 must fail the version check',
    mutation: {
      file: 'package-lock.json',
      anchor: '"node_modules/nodemailer": {\n      "version": "9.1.1",',
      replacement: '"node_modules/nodemailer": {\n      "version": "9.0.3",',
    },
  },
  {
    sc_id: 'SC1',
    check: 'npm run build',
    expect:
      'a broken site URL in the astro config must fail the build (schema validation)',
    mutation: {
      file: 'astro.config.mjs',
      anchor: "site: 'https://omf-therapie.fr',",
      replacement: "site: 'not-a-url',",
    },
  },
];

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function run(cmd) {
  const res = spawnSync('bash', ['-lc', cmd], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exit: res.status,
    output: `${res.stdout ?? ''}\n${res.stderr ?? ''}`
      .replace(ANSI, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240),
  };
}

function die(msg) {
  console.error(`[run-falsify-170] ${msg}`);
  process.exit(1);
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: REPO,
  encoding: 'utf8',
}).trim();

// Sources must start clean — mutations are temporary edits, never committed.
const status = spawnSync(
  'git',
  ['status', '--porcelain', '--', ...new Set(ROWS.map(r => r.mutation.file))],
  { cwd: REPO, encoding: 'utf8' },
);
if (status.stdout.trim() !== '') {
  die(`mutated files must be clean before running:\n${status.stdout}`);
}

const rows = [];
let passControlOk = true;

// Pass control: every check green on the un-mutated tree, else nothing is proven.
for (const row of ROWS) {
  const { exit } = run(row.check);
  if (exit !== 0) {
    passControlOk = false;
    rows.push({
      sc_id: row.sc_id,
      test_cmd: row.check,
      status: 'failed',
      error: `PASS CONTROL exit=${exit}`,
    });
  }
}

if (passControlOk) {
  for (const row of ROWS) {
    const { file, anchor, replacement } = row.mutation;
    const path = resolve(REPO, file);
    const original = readFileSync(path, 'utf8');
    const count = original.split(anchor).length - 1;
    if (count !== 1) {
      rows.push({
        sc_id: row.sc_id,
        test_cmd: row.check,
        status: 'failed',
        error: `anchor occurs ${count}x (expected 1) — stale anchor, mutation not applied`,
      });
      continue;
    }
    writeFileSync(path, original.replace(anchor, replacement));
    const mutated = run(row.check);
    // Restore BEFORE judging: the tree never stays mutated.
    writeFileSync(path, original);
    const restored = readFileSync(path, 'utf8');
    if (sha256(restored) !== sha256(original)) {
      rows.push({
        sc_id: row.sc_id,
        test_cmd: row.check,
        status: 'failed',
        error: 'RESTORE FAILED — byte mismatch',
      });
      continue;
    }
    if (mutated.exit === 0) {
      rows.push({
        sc_id: row.sc_id,
        test_cmd: row.check,
        status: 'failed',
        error: 'TAUTOLOGICAL: check passed under mutation',
      });
      continue;
    }
    rows.push({
      sc_id: row.sc_id,
      test_cmd: row.check,
      expect: row.expect,
      mutation: `${file}: ${JSON.stringify(anchor).slice(0, 80)} → …`,
      fail_exit: mutated.exit,
      error: `FAIL exit=${mutated.exit}: ${mutated.output}`,
      status: 'proven',
    });
  }
}

const proven = rows.filter(r => r.status === 'proven').length;
const ok = passControlOk && proven === ROWS.length;

const doc = {
  schema_version: '2',
  issue: 170,
  head,
  runner_id: RUNNER_ID,
  oracle_ok: ok,
  oracle_reason: ok
    ? 'ok'
    : passControlOk
      ? 'row-failed'
      : 'pass-control-failed',
  rows,
};
writeFileSync(OUT_JSON, JSON.stringify(doc, null, 2) + '\n');

const md = [
  '## SC → Falsification (v2, semantic mutations)',
  '',
  '| SC | Gate | Mutation | Status |',
  '|----|------|----------|--------|',
  ...rows.map(
    r =>
      `| ${r.sc_id} | \`${r.test_cmd.slice(0, 60)}\` | ${(r.mutation ?? '').slice(0, 60)} | ${r.status === 'proven' ? '✓ proven' : '✗ ' + r.error.slice(0, 80)} |`,
  ),
  '',
  `oracle_ok=${ok} (${proven}/${ROWS.length} rows proven)`,
  '',
];
writeFileSync(OUT_MD, md.join('\n'));

console.log(`oracle_ok=${ok} — ${proven}/${ROWS.length} rows proven`);
