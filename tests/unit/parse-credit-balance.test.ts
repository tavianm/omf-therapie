import { describe, expect, it } from 'vitest';
import { parseCreditBalance } from '../../src/utils/credits';

/**
 * Contrat de `GET /api/admin/credits` : `{ balance, history }` (balance en
 * centimes). Toute autre forme doit renvoyer null — notamment la clé
 * historique `available` qui désactivait silencieusement la case
 * « Utiliser l'avoir » du tiroir (#177).
 */
describe('parseCreditBalance', () => {
  it('reads balance from the real response shape { balance, history }', () => {
    // Arrange — forme réelle renvoyée par l'endpoint.
    const body = { balance: 5000, history: [{ id: 'credit-1', remaining: 5000 }] };

    // Assert
    expect(parseCreditBalance(body)).toBe(5000);
  });

  it('returns null when balance is missing (history only)', () => {
    // Arrange / Assert
    expect(parseCreditBalance({ history: [] })).toBeNull();
  });

  it('returns null for the legacy `available` key — the #177 regression oracle', () => {
    // Arrange — l'ancienne forme lue par le tiroir : ne doit plus être acceptée.
    const body = { available: 5000 };

    // Assert
    expect(parseCreditBalance(body)).toBeNull();
  });

  it('returns null for null body', () => {
    // Arrange / Assert
    expect(parseCreditBalance(null)).toBeNull();
  });

  it('returns null for a text body', () => {
    // Arrange / Assert
    expect(parseCreditBalance('text')).toBeNull();
  });

  it('returns null for a string balance (no coercion)', () => {
    // Arrange / Assert
    expect(parseCreditBalance({ balance: '5000' })).toBeNull();
  });

  it('returns null for a NaN balance', () => {
    // Arrange / Assert
    expect(parseCreditBalance({ balance: Number.NaN })).toBeNull();
  });
});
