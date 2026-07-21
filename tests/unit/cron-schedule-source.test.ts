import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Regression #113 — Netlify static schedule extraction
// ---------------------------------------------------------------------------
//
// BUG: `export const config = { schedule: SCHEDULE }` (Identifier reference)
// silently produced `schedule: null` on Netlify because @netlify/zip-it-and-
// ship-it's `parsePrimitive` (parser/exports.js) only resolves literal nodes
// (StringLiteral, NumericLiteral, BooleanLiteral, …), NOT Identifiers. The
// scheduler then had nothing to trigger → both crons stopped running from
// 2026-07-17 (#75 merge) to 2026-07-21 (this fix).
//
// These tests read the cron SOURCE as text (NOT via import — zisi parses
// source text, not runtime values, so this mirrors the real extraction) and
// assert that the `schedule:` property inside `export const config` is an
// inline string literal. A reverted fix (`schedule: SCHEDULE`) fails this
// suite, which is the falsification contract.
//
// The cron runtime wiring (withMonitor opts, initSentry ordering) is covered
// by cron-handlers.test.ts. This file guards the bundler contract that
// cron-handlers.test.ts cannot reach (it runs under Vitest, not zisi).

const REPO_ROOT = resolve(__dirname, '..', '..');

function readCronSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

/**
 * Extracts the body of `export const config = { ... }` from source text.
 * Returns the first match's inner block (without braces), or throws if the
 * config export is absent (which would itself be a regression — the cron
 * could not be scheduled at all).
 *
 * Comments are stripped from the block before returning: zisi's
 * `parsePrimitive` walks the AST (never sees comments), and our explanatory
 * warning comment mentions `schedule: SCHEDULE` to document the forbidden
 * pattern — keeping the comment would false-positive the Identifier guard.
 */
function extractConfigBlock(source: string): string {
  // Matches `export const config` optionally typed (`: Config`), then `=`,
  // then a brace block. Non-greedy on the inner content so it stops at the
  // first balanced `}` (the config object is flat — no nested objects here).
  const match = source.match(
    /export\s+const\s+config(?:\s*:\s*\w+)?\s*=\s*\{([\s\S]*?)\n\}/,
  );
  if (!match || match[1] === undefined) {
    throw new Error(
      'export const config = { ... } not found — cron has no Netlify schedule export',
    );
  }
  // Strip line comments (`// …`) and block comments so only actual properties
  // remain for pattern matching.
  return match[1]
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('regression #113 — Netlify schedule extraction', () => {
  describe('send-reminders', () => {
    const source = readCronSource('netlify/functions/send-reminders.ts');

    it('exports `config.schedule` as an inline string literal', () => {
      // parsePrimitive accepts StringLiteral only — an Identifier
      // (`schedule: SCHEDULE`) would silently become `schedule: null`.
      const config = extractConfigBlock(source);
      expect(config).toMatch(/schedule:\s*['"]/);
      // Hard-falsification: an Identifier reference must NOT be present.
      expect(config).not.toMatch(/schedule:\s*SCHEDULE\b/);
    });

    it('declares the expected daily 18:00 UTC crontab', () => {
      const config = extractConfigBlock(source);
      expect(config).toMatch(/schedule:\s*['"]0 18 \* \* \*['"]/);
    });
  });

  describe('calendar-token-heartbeat', () => {
    const source = readCronSource('netlify/functions/calendar-token-heartbeat.ts');

    it('exports `config.schedule` as an inline string literal', () => {
      const config = extractConfigBlock(source);
      expect(config).toMatch(/schedule:\s*['"]/);
      expect(config).not.toMatch(/schedule:\s*SCHEDULE\b/);
    });

    it('declares the expected weekly Sunday 00:00 UTC crontab', () => {
      const config = extractConfigBlock(source);
      expect(config).toMatch(/schedule:\s*['"]0 0 \* \* 0['"]/);
    });
  });

  describe('reconcile-confirmations', () => {
    // Sweep horaire (#68) — same Netlify static-extraction contract as the
    // other two crons. This block was added alongside the sweep to lock the
    // literal-inline + initSentry-before-withMonitor invariants from day one
    // (the sweep was originally written with `schedule: SCHEDULE` and
    // initSentry() inside runReconcile, then realigned on main's canonical
    // pattern from #114 during a post-#114 rebase).
    const source = readCronSource('netlify/functions/reconcile-confirmations.ts');

    it('exports `config.schedule` as an inline string literal', () => {
      const config = extractConfigBlock(source);
      expect(config).toMatch(/schedule:\s*['"]/);
      expect(config).not.toMatch(/schedule:\s*SCHEDULE\b/);
    });

    it('declares the expected hourly :05 UTC crontab', () => {
      const config = extractConfigBlock(source);
      expect(config).toMatch(/schedule:\s*['"]5 \* \* \* \*['"]/);
    });
  });

  describe('SCHEDULE const stays in sync with the inline literal', () => {
    // Defense against the DRY break introduced by this fix: the literal in
    // `config.schedule` and the `SCHEDULE` const (consumed by withMonitor)
    // must agree, or Sentry's monitor cadence drifts from Netlify's trigger.
    it('send-reminders: const SCHEDULE === config.schedule literal', () => {
      const source = readCronSource('netlify/functions/send-reminders.ts');
      const constMatch = source.match(/const\s+SCHEDULE\s*=\s*['"]([^'"]+)['"]/);
      const config = extractConfigBlock(source);
      const literalMatch = config.match(/schedule:\s*['"]([^'"]+)['"]/);
      expect(constMatch, 'const SCHEDULE declaration not found').not.toBeNull();
      expect(literalMatch, 'inline schedule literal not found').not.toBeNull();
      expect(constMatch![1]).toBe(literalMatch![1]);
    });

    it('calendar-token-heartbeat: const SCHEDULE === config.schedule literal', () => {
      const source = readCronSource('netlify/functions/calendar-token-heartbeat.ts');
      const constMatch = source.match(/const\s+SCHEDULE\s*=\s*['"]([^'"]+)['"]/);
      const config = extractConfigBlock(source);
      const literalMatch = config.match(/schedule:\s*['"]([^'"]+)['"]/);
      expect(constMatch, 'const SCHEDULE declaration not found').not.toBeNull();
      expect(literalMatch, 'inline schedule literal not found').not.toBeNull();
      expect(constMatch![1]).toBe(literalMatch![1]);
    });

    it('reconcile-confirmations: const SCHEDULE === config.schedule literal', () => {
      const source = readCronSource('netlify/functions/reconcile-confirmations.ts');
      const constMatch = source.match(/const\s+SCHEDULE\s*=\s*['"]([^'"]+)['"]/);
      const config = extractConfigBlock(source);
      const literalMatch = config.match(/schedule:\s*['"]([^'"]+)['"]/);
      expect(constMatch, 'const SCHEDULE declaration not found').not.toBeNull();
      expect(literalMatch, 'inline schedule literal not found').not.toBeNull();
      expect(constMatch![1]).toBe(literalMatch![1]);
    });
  });

  describe('regression #113 (secondary) — initSentry() ordering in handler()', () => {
    // `Sentry.withMonitor` emits an `in_progress` check-in at entry, and only
    // that check-in carries the `monitor_config` (with `checkInMargin`). If
    // `initSentry()` runs INSIDE the wrapped callback (the old layout), the
    // check-in is emitted before any client exists → dropped → Sentry receives
    // `checkin_margin: null`. The fix moves `initSentry()` into `handler()`
    // BEFORE the `Sentry.withMonitor(...)` call.
    //
    // This is a source-shape invariant (not a runtime one): the runtime spy
    // ordering in cron-handlers.test.ts is fragile to the idempotency guard's
    // module-level `initialized` flag, so we assert on source text instead —
    // which is also how zisi sees the file (statically).
    function assertInitBeforeWithMonitor(source: string, label: string): void {
      const handlerMatch = source.match(
        /async\s+function\s+handler\s*\([^)]*\)\s*:\s*Promise<void>\s*\{([\s\S]*?)\n\}/,
      );
      expect(handlerMatch, `${label}: handler() function not found`).not.toBeNull();
      const body = handlerMatch![1];
      const initIdx = body.indexOf('initSentry()');
      const withMonitorIdx = body.indexOf('Sentry.withMonitor(');
      expect(initIdx, `${label}: initSentry() call not found in handler()`).toBeGreaterThan(-1);
      expect(withMonitorIdx, `${label}: Sentry.withMonitor() call not found in handler()`).toBeGreaterThan(-1);
      expect(
        initIdx,
        `${label}: initSentry() must appear BEFORE Sentry.withMonitor() in handler() so the in_progress check-in carries monitor_config`,
      ).toBeLessThan(withMonitorIdx);
    }

    it('send-reminders: initSentry() precedes Sentry.withMonitor() inside handler()', () => {
      const source = readCronSource('netlify/functions/send-reminders.ts');
      assertInitBeforeWithMonitor(source, 'send-reminders');
    });

    it('calendar-token-heartbeat: initSentry() precedes Sentry.withMonitor() inside handler()', () => {
      const source = readCronSource('netlify/functions/calendar-token-heartbeat.ts');
      assertInitBeforeWithMonitor(source, 'calendar-token-heartbeat');
    });

    it('reconcile-confirmations: initSentry() precedes Sentry.withMonitor() inside handler()', () => {
      const source = readCronSource('netlify/functions/reconcile-confirmations.ts');
      assertInitBeforeWithMonitor(source, 'reconcile-confirmations');
    });
  });
});
