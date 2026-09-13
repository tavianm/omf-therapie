#!/usr/bin/env node
/**
 * Falsification runner — issue #153 acceptance criteria (SC1–SC8).
 *
 * Replaces the retired ephemeral run-falsify/1 (revue #154): that oracle
 * deleted WHOLE source modules and admitted any nonzero Vitest exit — but a
 * deleted imported module fails at collection/module-resolution BEFORE any
 * criterion-specific assertion can run, so "proven" proved nothing. This
 * runner enforces the opposite:
 *
 *   - every mutation is CRITERION-SPECIFIC and COMPILING: an exact-match
 *     string substitution on the guard/statement that implements one SC,
 *     applied only when the anchor occurs EXACTLY ONCE (a stale anchor
 *     aborts the row — mutations can never silently no-op);
 *   - the mapped test file(s) must COMPLETE: exit ≠ 0 with a parsed
 *     "N failed" test summary — collection/transform/unhandled errors are
 *     REJECTED as evidence;
 *   - at least one FAILING TEST NAME must match the row's `expect_test`
 *     regex — the failure must come from the intended assertion, not from
 *     an unrelated breakage;
 *   - a PASS CONTROL (un-mutated run of each test-file set) must be green
 *     before any mutated run is admitted.
 *
 * Sources are required CLEAN (== HEAD) before and after every row: the
 * artifact's `head` therefore identifies the exact implementation state
 * under test, and the per-source sha256 hashes pin it byte-for-byte.
 *
 * Usage: node scripts/run-falsify.mjs
 * Writes: artifacts/reviews/153-falsify.json + 153-falsify.md
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = resolve(REPO, 'artifacts/reviews/153-falsify-map.json');
const OUT_JSON = resolve(REPO, 'artifacts/reviews/153-falsify.json');
const OUT_MD = resolve(REPO, 'artifacts/reviews/153-falsify.md');
const RUNNER_ID = 'run-falsify/2';

const ANSI = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function die(msg) {
  console.error(`[run-falsify] ${msg}`);
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', ...opts });
}

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Runs vitest on `testFiles`, returns { exit, output } (ANSI stripped). */
function runVitest(testFiles) {
  const res = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      ...testFiles,
      '--maxWorkers=1',
    ],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return {
    exit: res.status,
    output: `${res.stdout ?? ''}\n${res.stderr ?? ''}`.replace(ANSI, ''),
  };
}

/** Extracts the failing test names from a vitest basic-reporter output. */
function failingTestNames(output) {
  const names = new Set();
  for (const m of output.matchAll(/FAIL\s+(\S+\.test\.ts)\s*>\s*(.+)/g)) {
    names.add(`${m[1]} > ${m[2].trim()}`);
  }
  // Fallback: the per-test failure listing uses "× name" markers.
  for (const m of output.matchAll(/×\s+(.{8,})/g)) {
    names.add(m[1].trim());
  }
  return [...names];
}

function testSummary(output) {
  const m = output.match(/Tests\s+(\d+) failed \|\s+(\d+) passed/);
  if (!m) return null;
  return { failed: Number(m[1]), passed: Number(m[2]) };
}

const COLLECTION_ERROR =
  /(Failed to load url|Failed to resolve|Transform.*failed|Unhandled Error|ERR_|SyntaxError)/i;

// --- 0. Preflight -------------------------------------------------------------
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const HEAD = git(['rev-parse', 'HEAD']).trim();
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
console.log(`[run-falsify] head ${HEAD} (${branch})`);

const allFiles = [
  ...new Set(map.rows.flatMap(r => r.mutations.map(m => m.file))),
];
const dirty = git(['status', '--porcelain', '--', ...allFiles]).trim();
if (dirty !== '') {
  die(
    `working tree not clean for the mutated sources — commit first (freeze the implementation):\n${dirty}`,
  );
}
// The generated build-env shim must exist for the cron imports.
execFileSync(process.execPath, ['scripts/generate-build-env.mjs'], {
  cwd: REPO,
  stdio: 'inherit',
});

// --- 1. Pass controls (one per unique test-file set) ---------------------------
const controls = new Map(); // key -> { exit, failed, passed }
for (const row of map.rows) {
  const key = row.test_files.join(' ');
  if (controls.has(key)) continue;
  const { exit, output } = runVitest(row.test_files);
  const summary = testSummary(output);
  controls.set(key, { exit, ...summary, output });
  if (exit !== 0) {
    die(
      `PASS CONTROL failed for [${key}] — the suite must be green un-mutated:\n${output.slice(-3000)}`,
    );
  }
  console.log(`[run-falsify] pass control ✓ [${key}] (${summary?.passed ?? '?'} passed)`);
}

// --- 2. Mutated runs ------------------------------------------------------------
const rows = [];
let allProven = true;

for (const row of map.rows) {
  const files = [...new Set(row.mutations.map(m => m.file))];
  const sourceHashes = {};
  for (const f of files) {
    sourceHashes[f] = sha256(readFileSync(resolve(REPO, f), 'utf8'));
  }

  let applied = true;
  const appliedMutations = [];
  for (const mutation of row.mutations) {
    const abs = resolve(REPO, mutation.file);
    const original = readFileSync(abs, 'utf8');
    // Line-ending-agnostic match: normalize to LF, apply, then write back in
    // the file's ORIGINAL style (CRLF checkouts must not stale multiline
    // anchors).
    const crlf = original.includes('\r\n');
    const normalized = original.replace(/\r\n/g, '\n');
    const count = normalized.split(mutation.find).length - 1;
    if (count !== 1) {
      rows.push({
        sc_id: row.sc_id,
        status: 'anchor-stale',
        error: `anchor for ${mutation.file} matched ${count} times (expected exactly 1) — update 153-falsify-map.json`,
      });
      allProven = false;
      applied = false;
      break;
    }
    const mutated = normalized.replace(mutation.find, mutation.replace);
    writeFileSync(abs, crlf ? mutated.replace(/\n/g, '\r\n') : mutated);
    appliedMutations.push(`${mutation.file}: "${mutation.find.slice(0, 60)}…"`);
  }

  if (applied) {
    const { exit, output } = runVitest(row.test_files);
    const summary = testSummary(output);
    const failedNames = failingTestNames(output);
    const matched = failedNames.filter(n => n.includes(row.expect_test));
    const collectionError = COLLECTION_ERROR.test(output);
    const proven =
      exit !== 0 &&
      summary !== null &&
      summary.failed > 0 &&
      !collectionError &&
      matched.length > 0;

    rows.push({
      sc_id: row.sc_id,
      criterion: row.criterion,
      sources: files,
      source_hashes: sourceHashes,
      mutations: appliedMutations,
      test_cmd: `node scripts/generate-build-env.mjs && node node_modules/vitest/vitest.mjs run ${row.test_files.join(' ')} --maxWorkers=1`,
      fail_exit: exit,
      assertion_failures: matched,
      summary: summary ? `${summary.failed} failed | ${summary.passed} passed` : 'no test summary parsed',
      collection_error: collectionError || undefined,
      status: proven ? 'proven' : 'REFUTED',
      evidence: matched[0] ?? (collectionError ? 'collection/transform error — NOT admission evidence' : 'no expect_test-matching failure'),
    });
    if (!proven) allProven = false;
    console.log(
      `[run-falsify] ${row.sc_id} ${proven ? 'proven' : 'REFUTED'} — ${matched[0] ?? 'no matching assertion failure'}`,
    );
  }

  // Restore under ALL circumstances; verify byte-for-byte.
  git(['checkout', '--', ...files]);
  const still = git(['status', '--porcelain', '--', ...files]).trim();
  if (still !== '') {
    die(`failed to restore ${files.join(', ')} — aborting:\n${still}`);
  }
}

// --- 3. Artifacts -----------------------------------------------------------------
const artifact = {
  schema_version: '2',
  issue: 153,
  head: HEAD,
  runner_id: RUNNER_ID,
  oracle_ok: allProven,
  oracle_reason: allProven
    ? 'ok — every SC row: pass control green, compiling criterion-specific mutation, targeted suite completed with ≥1 expect_test-matching assertion failure'
    : 'falsified — at least one row failed admission (see rows)',
  generated_at: new Date().toISOString(),
  rows,
};
writeFileSync(OUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`);

const md = [
  '# Falsification evidence — issue #153 SC1–SC8 (runner v2)',
  '',
  `Head under test: \`${HEAD}\` — the sources were clean (== HEAD) before and after every mutated run; per-source sha256 hashes in the JSON artifact pin the exact bytes.`,
  '',
  'Oracle contract (revue #154): each row applies a criterion-specific COMPILING mutation (exact-match, unique anchor enforced) and admits `proven` only when the mapped suite COMPLETES with an assertion failure matching `expect_test`. Module deletion / collection failures are structurally inadmissible.',
  '',
  '## SC → Test Matrix',
  '',
  '| SC | Mutation (anchor) | Test file(s) | Status | Assertion failure |',
  '|----|-------------------|--------------|--------|-------------------|',
  ...rows.map(
    r =>
      `| ${r.sc_id} | \`${(r.mutations?.[0] ?? r.error).slice(0, 70)}\` | ${r.sc_id ? '' : ''}${(r.sources ?? []).map(s => s.split('/').pop()).join(', ')} | ${r.status === 'proven' ? '✓ proven' : `✗ ${r.status}`} | ${r.evidence ?? ''} |`,
  ),
  '',
  '## Falsification Evidence',
  '',
  ...rows.map(
    r =>
      `broke ${r.sc_id} (${(r.sources ?? []).join(', ')}) → exit=${r.fail_exit ?? 'n/a'}, ${r.summary ?? r.error ?? ''}${r.assertion_failures?.length ? ` — failing: ${r.assertion_failures[0]}` : ''}`,
  ),
  '',
].join('\n');
writeFileSync(OUT_MD, md);

console.log(
  `\n[run-falsify] oracle_ok=${allProven} — artifacts written to artifacts/reviews/153-falsify.{json,md}`,
);
if (!allProven) process.exitCode = 2;
