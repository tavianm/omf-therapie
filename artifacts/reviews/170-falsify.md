## SC → Test Matrix

| SC | Test(s) | Status |
|----|---------|--------|
| SC2: | `npm audit --omit=dev --audit-level=high` | ✓ proven |
| SC4: | `test -f src/content.config.ts && ! grep -q "type: 'content'" src/content.config.ts && grep -q "astro/zod" src/content.config.ts` | ✓ proven |
| SC11: | `grep -q 'compressHTML: true' astro.config.mjs` | ✓ proven |
| SC12: | `cat .nvmrc | grep -qE '^v?22\.' && ! grep -q NODE_VERSION netlify.toml && test "$(grep -c 'node-version-file' .github/workflows/ci.yml)" = "2"` | ✓ proven |
| SC13: | `grep -q 'audit-level=high' .github/workflows/ci.yml` | ✓ proven |
| SC15: | `grep -A1 '"node_modules/nodemailer"' package-lock.json | grep -q '9\.1\.'` | ✓ proven |
| SC1: | `npm ci --silent && npm run build` | ✓ proven |

## Falsification Evidence

broke package-lock.json → FAIL exit=1: bash: warning: setlocale: LC_ALL: cannot change locale (fr_FR.UTF-8) npm error code ENOLOCK npm error audit This command requires an existing lockfile. npm error audit Try creating one first with: npm i --package-lock-only npm error audit O
broke src/content.config.ts → FAIL exit=1: bash: warning: setlocale: LC_ALL: cannot change locale (fr_FR.UTF-8) 
broke astro.config.mjs → FAIL exit=2: bash: warning: setlocale: LC_ALL: cannot change locale (fr_FR.UTF-8) grep: astro.config.mjs: No such file or directory 
broke .nvmrc → FAIL exit=1: bash: warning: setlocale: LC_ALL: cannot change locale (fr_FR.UTF-8) cat: .nvmrc: No such file or directory 
broke .github/workflows/ci.yml → FAIL exit=2: bash: warning: setlocale: LC_ALL: cannot change locale (fr_FR.UTF-8) grep: .github/workflows/ci.yml: No such file or directory 
broke package-lock.json → FAIL exit=1: bash: warning: setlocale: LC_ALL: cannot change locale (fr_FR.UTF-8) grep: package-lock.json: No such file or directory 
broke astro.config.mjs → FAIL exit=1:  > omf-therapie@1.0.0 prebuild > node scripts/generate-build-env.mjs  [build-env] wrote netlify/functions/_lib/build-env.ts (CONTEXT=development, COMMIT_REF=dev)  > omf-therapie@1.0.0 build > astro build  bash: warning: setlocale: LC_ALL: c
