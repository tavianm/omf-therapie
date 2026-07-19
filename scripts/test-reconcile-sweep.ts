// Local invocation of reconcile-confirmations sweep for manual testing.
// Usage: npx tsx scripts/test-reconcile-sweep.ts
//
// Loads .env into process.env + stubs import.meta.env (the sweep's import chain
// reads import.meta.env at module load via src/lib/supabase.ts).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const worktreeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  // Load .env into process.env
  const envPath = path.join(worktreeRoot, '.env');
  const envVars: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      envVars[key] = val;
      if (!(key in process.env)) process.env[key] = val;
    }
  }

  // Stub import.meta.env BEFORE importing the sweep (notifications → resend →
  // supabase all read import.meta.env at module load). tsx doesn't define it.
  // Use define import.meta.env via Object.assign — tsx respects this for user modules.
  (import.meta as unknown as { env: Record<string, string | undefined> }).env = {
    ...envVars,
    ...process.env,
  };
  // Suppress Sentry so withMonitor is a pure no-op
  delete process.env.PUBLIC_SENTRY_DSN;
  delete (import.meta as unknown as { env: Record<string, string | undefined> }).env
    .PUBLIC_SENTRY_DSN;

  console.log('=== ENV check ===');
  console.log('SUPABASE_DATABASE_URL:', process.env.SUPABASE_DATABASE_URL);
  console.log('SMTP_HOST:', process.env.SMTP_HOST, 'SMTP_PORT:', process.env.SMTP_PORT);
  console.log('ADMIN_EMAIL:', process.env.ADMIN_EMAIL);
  console.log('BETTER_AUTH_SECRET length:', process.env.BETTER_AUTH_SECRET?.length);
  console.log(
    'import.meta.env.SUPABASE_DATABASE_URL:',
    (import.meta as unknown as { env: Record<string, string | undefined> }).env
      ?.SUPABASE_DATABASE_URL,
  );
  console.log('');

  const handlerPath = path.join(worktreeRoot, 'netlify/functions/reconcile-confirmations.ts');
  const handlerUrl = new URL('file://' + handlerPath).href;
  const handlerModule = await import(handlerUrl);
  const handler = handlerModule.default;
  console.log('=== Invoking sweep handler ===');
  try {
    await handler();
    console.log('=== Sweep completed ===');
  } catch (err) {
    console.error('=== Sweep threw:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('main() error:', err);
  process.exit(1);
});
