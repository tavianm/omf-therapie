# Testing

## Strategy

- Vitest covers unit and integration-level server and domain behavior in `tests/unit/`.
- Playwright covers key browser flows in `e2e/`.
- Pa11y audits accessibility; UI changes require the audit.

## Tools

- Vitest runs in Node and uses a shared setup file.
- Playwright uses the local Astro site.

## Conventions

- Name unit tests `*.test.ts` under `tests/unit/`.
- Keep reusable appointment eligibility logic pure and test it directly.

## Run

- `npm run test`
- `npx playwright test`
- `npm run audit:a11y`

## WSL-safe validation

- Use the Linux Node runtime declared by `.nvmrc` for every Node/npm command. The reliable one-shot form is `~/.local/share/fnm/fnm exec --using="$(cat .nvmrc)" <command>`.
- Never use a Windows `node` or `npm` resolved through `/mnt/<drive>/...` from WSL. On a UNC worktree it can fall back to `C:\Windows`, break relative scripts, and leave a partial `node_modules` installation.
- In a new worktree, run `tools/worktree-setup.sh` once through `fnm`. Do not overlap `npm install` or `npm ci` processes; if an install is interrupted, repair the dependency tree before validation.
- Run quality gates sequentially, never concurrently. Check `free -h` before increasing a Node heap limit.
- Run Vitest with one worker and no file/test parallelism:

  ```bash
  NODE_OPTIONS=--max-old-space-size=1024 \
    ~/.local/share/fnm/fnm exec --using="$(cat .nvmrc)" \
    npm run test -- --pool=threads --maxWorkers=1 --no-file-parallelism --maxConcurrency=1
  ```

- Astro Check needs more heap than the test suite in this project. Run it alone with a bounded 3 GiB heap:

  ```bash
  NODE_OPTIONS=--max-old-space-size=3072 \
    ~/.local/share/fnm/fnm exec --using="$(cat .nvmrc)" npm run typecheck
  ```

- Run the production build separately with a bounded 2 GiB heap:

  ```bash
  NODE_OPTIONS=--max-old-space-size=2048 \
    ~/.local/share/fnm/fnm exec --using="$(cat .nvmrc)" npm run build
  ```

- A Node heap-limit failure is not a code diagnostic. Record it as an environment failure, adjust only after checking available memory, and rerun the affected gate alone.

## Browser QA

- Entry: `http://localhost:4321` after `npm run dev`.
- State: local Docker services and the documented Google Calendar and Stripe mocks support deterministic development.
