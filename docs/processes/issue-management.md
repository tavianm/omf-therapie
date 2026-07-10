# Issue Management

> How GitHub issues are triaged and tracked for omf-therapie. For the dev workflow see `dev-process.md`.

## Issue lifecycle

```
Open → Triaged (label + priority) → In Progress (branch linked) → PR → Merged → Closed
```

Issues are the **source of truth for intent**. Every non-trivial change starts as an issue.

## Labels

omf-therapie uses GitHub labels for triage. Conventional categories:

| Label group | Examples | Purpose |
|-------------|----------|---------|
| Type | `bug`, `feature`, `enhancement`, `docs`, `chore`, `ci` | What kind of work |
| Priority | `P1` (urgent), `P2` (next), `P3` (backlog) | Scheduling |
| Size | `S`, `M`, `L` | Effort estimate |
| Scope | `admin`, `booking`, `payment`, `a11y`, `seo`, `infra` | Affected domain |
| Status | `blocked`, `needs-info`, `wontfix` | State beyond open/closed |

> If labels are missing in the repo, infer from issue title/body. Recent issues use the `#<N>` convention in titles (`#63`, `#67`, `#68`) and "Size: M" notation.

## Triage rules

- **New issue →** acknowledge within a session; assign type + priority + size.
- **`P1`** = production broken or security; preempts other work.
- **`P2`** = next up (planned for the current week/cycle).
- **`P3`** = backlog (valuable but not urgent).
- **`needs-info`** → ping the requester; don't start work until clarified.
- **`blocked`** → note the blocker in a comment; unblock before resuming.

## Linking issues to PRs

- **Branch name:** `feat/<issue#>-<slug>` or `fix/<issue#>-<slug>`.
- **PR body:** `Fixes #N` (auto-closes on merge) or `Closes #N`.
- **Commit subject:** reference the issue (`fix(#63): …`).
- **One issue per PR** when feasible. If a PR closes multiple issues, list all (`Fixes #63, closes #64`).

## Naming convention (observed)

Recent issues follow a structured title format:
- `#63` — annulation/report RDV + système d'avoir interne
- `#67` — fix(ci): add lint + typecheck + test + build pipeline with branch protection
- `#68` — Stripe payment confirmation reconciliation + idempotency

PR titles echo the issue but with a conventional prefix and the issue number in parentheses:
- `feat(#63): annulation/report RDV + système d'avoir interne (#66)`

## Dev-core artifacts

Larger issues produce artifacts in `artifacts/` (committed to the feature branch):

| Artifact | Path | When |
|----------|------|------|
| Analysis | `artifacts/analyses/<N>-*.mdx` | Expert review / risk assessment (optional) |
| Frame | `artifacts/frames/<N>-*.mdx` | Scope + options + decision |
| Spec | `artifacts/specs/<N>-*.mdx` | Approved requirements |
| Plan | `artifacts/plans/<N>-*.mdx` | Sliced implementation plan |

The PR body's **Lifecycle table** links these artifacts so reviewers can trace the decision trail.

## Closing issues

- **Auto-close** via `Fixes #N` in the PR body (preferred).
- **Manual close** with a comment explaining why (if closed without a PR, e.g. `wontfix`).
- **Don't close** until the work is merged AND (if applicable) the migration/env vars are deployed.

## Stale issues

- Review open issues periodically.
- Comment on issues with no activity for >1 cycle: "Still relevant?" → close if no response.
- `needs-info` issues with no response after a reasonable period → close.

## AI Quick Reference

- **ALWAYS** create or reference an issue before starting non-trivial work.
- **ALWAYS** use `Fixes #N` in the PR body to auto-close the issue on merge.
- **ALWAYS** name branches `<type>/<issue#>-<slug>`.
- **NEVER** close an issue before its PR is merged (and deployed, if it touches prod state).
- **ALWAYS** assign type + priority + size labels during triage.
- **ALWAYS** link dev-core artifacts (frame/spec/plan) in the PR body's Lifecycle table when they exist.
- **PREFER** one issue per PR; list multiple `Fixes #N` only when genuinely coupled.
