/**
 * Parses the GET /api/admin/credits response body ({ balance, history },
 * balance in cents). Returns null for any other shape — including the
 * legacy `available` key that silently disabled the credit checkbox (#177).
 */
export function parseCreditBalance(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const balance = (body as { balance?: unknown }).balance;
  return typeof balance === 'number' && Number.isFinite(balance) ? balance : null;
}
