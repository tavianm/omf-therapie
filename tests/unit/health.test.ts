import { describe, it, expect } from 'vitest';

import { GET, prerender } from '@/pages/api/health';

function makeContext(): Parameters<typeof GET>[0] {
  return {
    request: new Request('https://omf-therapie.fr/api/health/'),
  } as Parameters<typeof GET>[0];
}

describe('GET /api/health', () => {
  it('declares prerender = false (SSR endpoint)', () => {
    expect(prerender).toBe(false);
  });

  it('returns 200 with { ok: true }', async () => {
    const response = await GET(makeContext());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('has no required query params or auth (lightweight probe)', async () => {
    // An empty context must succeed — the uptime monitor sends a bare GET.
    const response = await GET(makeContext());
    expect(response.ok).toBe(true);
  });
});
