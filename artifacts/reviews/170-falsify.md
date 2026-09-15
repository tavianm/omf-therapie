## SC → Falsification (v2, semantic mutations)

| SC | Gate | Mutation | Status |
|----|------|----------|--------|
| SC2 | `npm audit --omit=dev --audit-level=high` | package-lock.json: "\"node_modules/astro\": {\n      \"versi | ✓ proven |
| SC4 | `test -f src/content.config.ts && ! grep -q "type: 'content'"` | src/content.config.ts: "import { z } from 'astro/zod';" → … | ✓ proven |
| SC11 | `grep -q 'compressHTML: true' astro.config.mjs` | astro.config.mjs: "compressHTML: true," → … | ✓ proven |
| SC12 | `node -e "const [x,y]=process.argv[1].replace(/^v/,'').split(` | .nvmrc: "v22.23.2" → … | ✓ proven |
| SC13 | `grep -q 'audit-level=high' .github/workflows/ci.yml` | .github/workflows/ci.yml: "        run: npm audit --omit=dev | ✓ proven |
| SC15 | `grep -A1 '"node_modules/nodemailer"' package-lock.json | gre` | package-lock.json: "\"node_modules/nodemailer\": {\n      \" | ✓ proven |
| SC1 | `npm run build` | astro.config.mjs: "site: 'https://omf-therapie.fr'," → … | ✓ proven |

oracle_ok=true (7/7 rows proven)
