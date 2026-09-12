# Plan — Unify dev-core (roxabi) integration with latest skill contracts

**Date:** 2026-09-12
**Target contracts:** `R-dev-init` v0.9.4 · `R-stack-setup` v0.3.2 · `R-env-setup` v0.1.0 (verified against `R-dev-checkup` v0.8.2 cookbooks)
**Scope:** align this repo's dev-core integration with the plugin version cached at `~/.zcode/cli/plugins/cache/roxabi-marketplace/dev-core/0.0.0/`

---

## 1. Gap analysis — current state vs latest contract

### 1.1 Contract location — DIVERGED (the big one)

The latest contract moved the stack config from `.claude/` to **`.dev/`**. dev-core skills read `.dev/` only; a config left in `.claude/` is flagged `legacy contract layout` by checkup.

| Item | Current | Latest contract | Action |
|------|---------|-----------------|--------|
| stack.yml | `.claude/stack.yml` | `.dev/stack.yml` | **Migrate** (`git mv`) |
| stack.yml.example | `.claude/stack.yml.example` (old template) | `.dev/stack.yml.example` (current template) | Migrate + refresh from plugin |
| dev-core.yml (δ) | never existed | `.dev/dev-core.yml` | Create minimal (optional, §3.4) |

Because neither `.dev/dev-core.yml` nor `dev-core` in `.env` exists, a re-run of `/R-dev-init` today would treat the project as **uninitialized**.

### 1.2 stack.yml content drift — STALE

`.claude/stack.yml` was last committed around PR #59 and predates the Vitest/CI work (#85). Drift vs repo reality and vs the latest template:

| Field | Current | Should be | Why |
|-------|---------|-----------|-----|
| `testing.unit` | `none` | `vitest` | `package.json` has `"test": "vitest run"`, `tests/unit/**` exists, CI gates on test |
| `commands.test` | `npm run audit:a11y` | `npm run test` | Contract maps `test` → unit runner; keep a11y audit as a comment (it remains a pre-PR gate per AGENTS.md) |
| `commands.typecheck` | `npx astro check` | `npm run typecheck` | package.json script exists; contract rule: `{pm} run <key>` |
| `artifacts.brainstorms` | missing | `artifacts/brainstorms` | New key; `/R-interview` writes there |
| `release:` block | missing | present | **New in latest template.** `/R-promote` REFUSES when `release.component` is null |
| `frontend.framework` | `none` | `astro` | Truthful value (enum list is advisory; Astro is the real framework) |
| `standards.configuration` | `docs/configuration.md` (file does not exist) | create or drop | Checkup warns on any `standards.*` path not on disk |
| `standards.contributing` | `docs/contributing.md` (file does not exist) | create or drop | same |
| `review.roster` | absent | absent is fine | Absent → documented defaults apply (max_agents 4, adversarial floor, verifier@90) |
| `quality_gates` | absent | absent is fine | Opt-in; node runtime would only get `file_length` — skip (Astro components routinely exceed 300 lines) |

Keep unchanged: `schema_version: "1.0"` ✅, `deploy.platform: netlify` + `secrets_cmd`, `hooks.tool: auto`, `lsp.enabled: true`, `commands.worktree_setup/teardown` ✅, existing `standards.*` paths that do exist on disk.

### 1.3 Already compliant — NO action

| Contract item | Status |
|---------------|--------|
| Axial ADR (`R-dev-init` Phase 3a) | ✅ `docs/architecture/adr/001-domain-as-primary-axis-of-decomposition.mdx` has `axial: true` frontmatter, singleton invariant holds |
| Worktree scripts (`R-stack-setup` Phase 4b / `R-env-setup` Phase 1b) | ✅ `tools/worktree-setup.sh` + `tools/worktree-teardown.sh` exist, `commands.worktree_*` registered in σ |
| Docs scaffolding (`R-env-setup` Phase 3) | ✅ `docs/standards/`, `docs/guides/`, `docs/processes/`, `docs/architecture/` all populated (no stubs expected) |
| `artifacts/{analyses,frames,plans,specs}` | ✅ present (add `brainstorms/`) |

### 1.4 env-setup gaps

- **Phase 2 — CLAUDE.md Critical Rules:** not scaffolded (no `## Critical Rules` section in `CLAUDE.md`). Checkup: ⚠️ auto-fixable. Note: this repo now has AGENTS.md carrying workspace instructions; CLAUDE.md is the file the contract targets. → run `bun init.ts scaffold-rules`, user picks merge style (decision D4).
- **Phase 4 — LSP:** `ENABLE_LSP_TOOL=1` already in `.env.example` ✅. No local `.env` file exists at all; `typescript-language-server` not in PATH. Machine-local items (decision D6).

### 1.5 dev-init downstream (ci-setup / release-setup) — missing layers

| Artifact | Status | Note |
|----------|--------|------|
| `lefthook.yml` | missing | σ says `hooks.tool: auto` → node resolves to lefthook → checkup warns until `lefthook.yml` exists. Adopt it, or set `hooks.tool: none` (decision D3) |
| `.github/workflows/secret-scan.yml` + TruffleHog | missing | ci-setup contract; repo CI (#85) covers lint/test/build only |
| `.github/dependabot.yml` | missing | ci-setup contract |
| Release automation (Commitizen / Release Please / semantic-release) | missing, none configured | Checkup ⏭ (only checks if config exists). Project convention is French present-tense commits — default Commitizen templates would conflict; recommend skip (decision D5) |

### 1.6 Untracked debris (adjacent, not part of the contract)

- `.claude/worktrees/63-admin-annulation-avoir-credit-rdv/` — stale worktree from merged PR #63; untracked and not gitignored → add `.claude/worktrees/` to `.gitignore`, delete stale worktree (destructive — confirm).
- `aidd_docs/` — artifacts from a different plugin (review of "PR #134 calendar-keepwarm", numbering that doesn't match this repo) → decide: gitignore or remove (decision D7).
- `netlify/functions/_lib/build-env.ts` — header says AUTO-GENERATED by `scripts/generate-build-env.mjs`, which doesn't exist in this tree (local `main` may lag `origin/main` — AGENTS.md drift warning) → verify against origin before ignoring/committing (decision D7).

---

## 2. Execution phases

### Phase 1 — Migrate contract location (stack-setup Phase 0, O_stackMigrate)

```bash
mkdir -p .dev
git mv .claude/stack.yml .dev/stack.yml
git mv .claude/stack.yml.example .dev/stack.yml.example
cp "$CLAUDE_PLUGIN_ROOT/stack.yml.example" .dev/stack.yml.example   # refresh template to latest schema
```

**Rule:** never `cp` the template over the real `stack.yml` — migration must preserve tuned values (`release.*`, paths, commands). Nothing to migrate for `dev-core.yml` (never existed).

### Phase 2 — Sync `.dev/stack.yml` content

Apply the §1.2 table:

```yaml
testing:
  unit: vitest
  e2e: playwright

frontend:
  framework: astro

release:
  model: trunk            # no staging branch; site deploys on merge-to-main via Netlify
  class: NONE
  component: omf-therapie # REQUIRED non-null — /R-promote refuses otherwise
  version_files: []

artifacts:
  brainstorms: artifacts/brainstorms
  # ... existing keys

commands:
  test: npm run test            # unit runner; a11y audit stays a pre-PR gate (npm run audit:a11y)
  typecheck: npm run typecheck
```

### Phase 3 — Fill filesystem gaps

```bash
mkdir -p artifacts/brainstorms
```

Standards stubs (decision D1 — recommended: create with real short content, later enrich via `/R-seed-docs`):
- `docs/standards/configuration.md` (latest template default path)
- `docs/contributing.md`

### Phase 4 — Minimal dev-core.yml (decision D2 — recommended: yes)

Create `.dev/dev-core.yml`:

```yaml
# dev-core project config (public, committed — no secrets)
github_repo: tavianm/omf-therapie
```

Doubles as the `/R-dev-init` idempotency marker (Phase 1 checks `.dev/dev-core.yml`).

### Phase 5 — CLAUDE.md Critical Rules (env-setup Phase 2)

```bash
bun "$CLAUDE_PLUGIN_ROOT/skills/dev-init/init.ts" scaffold-rules --stack-path .dev/stack.yml --claude-md CLAUDE.md
```

Review JSON output (`projectType`, `sections`, `existing`, `facts`) → user gate with options Scaffold full / project-local only / Merge / Skip. Recommended: **Merge** (append only missing sections) to avoid clobbering the hand-maintained CLAUDE.md content.

### Phase 6 — Hooks & CI hygiene (decision D3)

Recommended: adopt lefthook (matches `hooks.tool: auto`) with staged-file eslint + secret scan, plus `secret-scan.yml` (TruffleHog) and `dependabot.yml`. Minimal alternative: set `hooks.tool: none` in σ to silence the checkup warning. Deferred if out of scope for this PR.

### Phase 7 — LSP (machine-local, decision D6 — optional)

```bash
npm install --save-dev typescript-language-server typescript
# optionally: claude plugin install typescript-lsp
# ensure ENABLE_LSP_TOOL=1 in the local env file used for dev
```

### Phase 8 — Debris cleanup (decision D7)

- Add `.claude/worktrees/` to `.gitignore`; delete the stale #63 worktree after confirmation.
- Resolve `aidd_docs/` (gitignore or remove) and `netlify/functions/_lib/` (check `origin/main` for the generator script first).

### Phase 9 — Verify

Run `/R-dev-checkup` (Phases 1–3: `doctor.ts` + stack/infra cookbooks). Expected end state:

- ❌ 0 blocking
- ✅ migration, schema fields, artifacts dirs, docs structure, standards paths, axial ADR, worktree hooks
- ⚠️ only machine-local items if skipped (LSP binary/plugin, lefthook if deferred, δ-dependent GitHub checks)

---

## 3. Decision points

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Missing standards paths | create stubs / drop keys | Create `docs/standards/configuration.md` + `docs/contributing.md` (with real content, not TODO) |
| D2 | Create minimal `.dev/dev-core.yml` | yes / no | Yes — enables dev-init idempotency + doctor `GITHUB_REPO` |
| D3 | lefthook | adopt / `hooks.tool: none` | Adopt later in a dedicated CI-hygiene PR; for this PR either is acceptable |
| D4 | Critical Rules merge style | full / project-local / merge / skip | Merge (missing sections only) |
| D5 | Release automation | skip / Commitizen / Release Please | Skip — French commit convention conflicts with default Commitizen; no tags/releases today |
| D6 | LSP local install | now / later | Later (machine-local, doesn't block the contract) |
| D7 | Untracked debris | gitignore / remove / investigate | Worktrees: gitignore+delete; `aidd_docs/`: user call; `netlify/functions/_lib/`: check origin first |

## 4. Suggested delivery

One PR: Phases 1–4 (+ `.gitignore` entry for `.claude/worktrees/`), commit message French present tense, e.g. « Migre la config dev-core vers .dev/ et synchronise stack.yml au contrat 0.3.2 ». Phase 5 (CLAUDE.md) can ride the same PR or a follow-up docs PR; Phases 6–8 are separable.

---

## 5. Execution notes (2026-09-12 — executed same day)

Deviations discovered during execution, all captured in the diff:

1. **`main` was fast-forwarded to `origin/main` first** (c620c14 → 5f22ffc, per the AGENTS.md drift rule). Upstream had already fixed vitest in stack.yml (`9392326`), added Prettier (`format: prettier --write .`), added `.github/dependabot.yml`, and gitignored `.claude/worktrees/` — several plan items resolved themselves.
2. **Formatter corrected to Prettier** (not in original gap table): `build.formatter: prettier`, `formatter_config: .prettierrc.json`, `formatter_fix_cmd: npm run format`, `commands.format: npm run format`.
3. **`release.model: staging-train`** (not `trunk`): doctor hard-fails `trunk` without `auto-release.yml`, which is deferred (D5). Default model tolerated; `component: omf-therapie` keeps `/R-promote` unblocked.
4. **Five worktrees removed, not one** — branches feat/63 (PR #66), feat/64 (PR #65), feat/67 (PR #85), feat/68 (PR #98), feat/86 (PR #88), all verified MERGED via gh before removal. Three dirs needed Node `fs.rmSync` (Windows long-path limit defeated `git worktree remove` and `rd`).
5. **`aidd_docs/` is tracked on origin** (commit e93e391 "doc: add aidd_docs") — not foreign debris. The new `aidd_docs/tasks/2026_09/…review.md` (PR #134 review) remains uncommitted; commit or ignore at will.
6. **`netlify/functions/_lib/build-env.ts` is generated by `scripts/generate-build-env.mjs`** (exists upstream, wired via predev/pretest/prebuild/pretypecheck) — legitimate build artifact, left in place.
7. **Critical Rules scaffold**: detector classifies the project as `stub` (expected sections: tldr, git). Added an `## TL;DR` section to CLAUDE.md — heading must be exactly `## TL;DR` (H2) to satisfy the matcher. Verified complete 2/2.

### Post-execution doctor state

- ✅ prerequisites, GITHUB_REPO (via new `.dev/dev-core.yml`), ci.yml, secret scanning, push protection, Actions read-only
- ⚠️ ci-setup fleet workflows still absent (auto-merge, merge-on-green, pr-title, context-lint, secret-scan, dependabot-automerge) — deferred per D3
- ❌ `main` unprotected / PR_Main ruleset missing — GitHub-side; deliberate follow-up (AGENTS.md already notes protection should require `CI / build`)
