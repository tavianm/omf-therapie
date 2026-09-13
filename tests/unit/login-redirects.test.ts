import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LOGIN_PATH_FORBIDDEN,
  LOGIN_PATH_UNAUTHENTICATED,
} from '../../src/utils/login-redirects';

// ---------------------------------------------------------------------------
// login-redirects — source de vérité unique des redirections admin (SC7).
//
// Le guard SSR de /poste-travail ET le hook de polling (useAppointmentsPolling)
// doivent rediriger vers EXACTEMENT les mêmes URLs : 401 → login avec
// ?redirect=/poste-travail/ (retour au poste après connexion), 403 → login
// avec ?error=acces-refuse. Un drift entre les deux ferait boucler ou
// égarait l'admin selon le chemin de déconnexion de session.
//
// Oracle à deux niveaux :
//   1. les constantes sont épinglées aux littéraux attendus (écrits ICI en
//      dur, indépendamment du module sous test) ;
//   2. les DEUX consommateurs référencent 'login-redirects' (import présent)
//      et ne contiennent plus les littéraux inline — un retour arrière vers
//      une URL codée en dur fait échouer ce test (miroir structurel, pas une
//      simple convention documentaire).
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, '..', '..');

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

describe('login-redirects — single source of truth for the admin login redirects (SC7)', () => {
  it('pins LOGIN_PATH_UNAUTHENTICATED to the expected login URL', () => {
    expect(LOGIN_PATH_UNAUTHENTICATED).toBe('/login/?redirect=/poste-travail/');
  });

  it('pins LOGIN_PATH_FORBIDDEN to the expected access-denied URL', () => {
    expect(LOGIN_PATH_FORBIDDEN).toBe('/login/?error=acces-refuse');
  });

  it('is consumed by the SSR guard of /poste-travail (import present, no inline literal)', () => {
    const source = readSource('src/pages/poste-travail.astro');
    expect(source).toContain('login-redirects');
    expect(source).not.toContain("'/login/?redirect=/poste-travail/'");
    expect(source).not.toContain("'/login/?error=acces-refuse'");
  });

  it('is consumed by the polling hook (import present, no inline literal)', () => {
    const source = readSource('src/hooks/useAppointmentsPolling.ts');
    expect(source).toContain('login-redirects');
    expect(source).not.toContain("'/login/?redirect=/poste-travail/'");
    expect(source).not.toContain("'/login/?error=acces-refuse'");
  });
});
