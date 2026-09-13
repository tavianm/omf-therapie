/**
 * GET /api/availability — contract tests (issue #153, task T8, SC7 + U1).
 *
 * Exercises the real handler with a synthetic Request (direct call, no HTTP
 * layer — no trailing-slash redirect concern at this level):
 *   - 200 shape {slots}, `Content-Type: application/json`,
 *     `Cache-Control: no-store`
 *   - 400 validation with the exact French messages (mode / duration / weeks)
 *   - typed shared-stage error from getAvailableSlots → 503 with the existing
 *     French message and ZERO cache writes (SC5, patient side)
 *   - cache HIT → slots re-filtered by live DB busy periods through the REAL
 *     shared `filterSlotsByBusy` (an overlapped slot must disappear)
 *   - cache write failure (rejection or 'failed' result) → still 200,
 *     non-fatal, console.error with sanitized payloads only (SC6)
 *
 * Mock boundaries: getAvailableSlots (Google I/O), the cache read/write
 * (Netlify Blobs), supabaseAdmin (DB busy periods) and scheduling settings.
 * `filterSlotsByBusy`, the typed error classes and `buildAvailabilityCacheKey`
 * stay REAL (spread from importOriginal) — they are part of the contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarSharedStageError } from '@/lib/google-calendar';
import { buildAvailabilityCacheKey } from '@/lib/calendar-cache';

// ---------------------------------------------------------------------------
// Hoisted state + spies (referenced from the vi.mock factories)
// ---------------------------------------------------------------------------

interface SlotLike {
  start: string;
  end: string;
  available: boolean;
}

const h = vi.hoisted(() => ({
  appointmentRows: [] as Array<Record<string, unknown>>,
  appointmentsError: null as { message: string } | null,
  cachedSlots: null as Array<SlotLike> | null,
  writeResult: 'written' as 'written' | 'skipped-no-store' | 'failed',
  writeReject: null as Error | null,
  getAvailableSlots: vi.fn(),
  getCachedAvailability: vi.fn(),
  setCachedAvailability: vi.fn(),
}));

// --- Supabase: fetchDbBusyPeriods reads `appointments` via a thenable chain --

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        in: () => chain,
        is: () => chain,
        or: () => chain,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve({
            data: h.appointmentRows,
            error: h.appointmentsError,
          }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

vi.mock('@/lib/scheduling-settings', () => ({
  getSchedulingSettings: vi.fn(
    async () =>
      ({ bufferMinutes: 0, updatedAt: '2026-01-01T00:00:00.000Z' }) as const,
  ),
}));

// --- google-calendar: mock ONLY the Google I/O seam; keep the shared pure
// filter, the typed error classes and the types real (they ARE the contract).

vi.mock('@/lib/google-calendar', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/google-calendar')>();
  return {
    ...actual,
    getAvailableSlots: h.getAvailableSlots,
  };
});

// --- calendar-cache: mock the Blobs read/write; keep the real key builder.
// The source imports with an explicit `.js` extension — mock BOTH specifiers
// (same resolved module; mirrors admin-appointments-post.test.ts). The
// factory is inlined twice: vi.mock calls are hoisted, so a shared const
// would hit a TDZ error.

vi.mock('@/lib/calendar-cache', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/calendar-cache')>();
  return {
    ...actual,
    getCachedAvailability: h.getCachedAvailability,
    setCachedAvailability: h.setCachedAvailability,
  };
});

vi.mock('@/lib/calendar-cache.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/calendar-cache')>();
  return {
    ...actual,
    getCachedAvailability: h.getCachedAvailability,
    setCachedAvailability: h.setCachedAvailability,
  };
});

// --- Import the handler AFTER mocks ------------------------------------------

import { GET } from '@/pages/api/availability';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Frozen "now": Monday 2026-06-15 11:00 Paris (CEST) — 4-week Monday key. */
const FROZEN_NOW = new Date('2026-06-15T09:00:00.000Z');
const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

const FREE_SLOT: SlotLike = {
  // Wednesday 2026-06-17 09:00 Paris — outside every DB busy window below.
  start: '2026-06-17T07:00:00.000Z',
  end: '2026-06-17T08:00:00.000Z',
  available: true,
};

const BUSY_OVERLAPPED_SLOT: SlotLike = {
  // Thursday 2026-06-18 15:00 Paris — overlaps the confirmed appointment
  // (13:30–14:30 UTC) seeded by seedDbBusyAppointment.
  start: '2026-06-18T13:00:00.000Z',
  end: '2026-06-18T14:00:00.000Z',
  available: true,
};

/** One confirmed appointment whose blocked window overlaps BUSY_OVERLAPPED_SLOT. */
function seedDbBusyAppointment(): void {
  h.appointmentRows = [
    {
      status: 'confirmed',
      duration: 60,
      scheduled_at: '2026-06-18T13:30:00.000Z',
      scheduled_end: '2026-06-18T14:30:00.000Z',
      blocked_until: '2026-06-18T14:30:00.000Z',
      rescheduled_to: null,
    },
  ];
}

function callGet(query: string): Promise<Response> {
  const request = new Request(`http://localhost/api/availability/?${query}`);
  return GET({ request } as never) as Promise<Response>;
}

async function readJson(response: Response): Promise<{
  slots?: SlotLike[];
  error?: string;
}> {
  return (await response.json()) as { slots?: SlotLike[]; error?: string };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Fake ONLY the clock — deterministic range bounds + cache key week.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);

  h.appointmentRows = [];
  h.appointmentsError = null;
  h.cachedSlots = null;
  h.writeResult = 'written';
  h.writeReject = null;

  h.getAvailableSlots.mockReset();
  h.getAvailableSlots.mockResolvedValue([FREE_SLOT]);
  h.getCachedAvailability.mockReset();
  // Read the live hoisted state so per-test seeding takes effect.
  h.getCachedAvailability.mockImplementation(async () => h.cachedSlots);
  h.setCachedAvailability.mockReset();
  h.setCachedAvailability.mockImplementation(async () => {
    if (h.writeReject) throw h.writeReject;
    return h.writeResult;
  });

  // Silence + capture handler logging (sanitization assertions below).
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  // Keep the setup.ts env stubs alive across afterEach unstubbing.
  vi.stubEnv('DEV', false);
  vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');
  vi.stubEnv('SUPABASE_DATABASE_URL', 'http://localhost:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ===========================================================================
// 200 happy path — shape, headers, Google seam args, cache write
// ===========================================================================

describe('GET /api/availability — happy path (SC7)', () => {
  it('returns 200 {slots} with no-store + application/json headers and writes the cache once', async () => {
    const slots = [FREE_SLOT, BUSY_OVERLAPPED_SLOT];
    h.getAvailableSlots.mockResolvedValue(slots);

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(readJson(response)).resolves.toEqual({ slots });

    // Google seam: default 4-week horizon from the frozen clock, empty DB busy
    // (no appointment rows seeded).
    expect(h.getAvailableSlots).toHaveBeenCalledTimes(1);
    const [start, end, duration, mode, dbBusy] = h.getAvailableSlots.mock
      .calls[0] as [
      Date,
      Date,
      number,
      string,
      Array<{ start: string; end: string }>,
    ];
    expect(start.getTime()).toBe(FROZEN_NOW.getTime());
    expect(end.getTime() - start.getTime()).toBe(FOUR_WEEKS_MS);
    expect(duration).toBe(60);
    expect(mode).toBe('video');
    expect(dbBusy).toEqual([]);

    // Cache write: real key builder, frozen week → stable Monday key.
    expect(h.setCachedAvailability).toHaveBeenCalledTimes(1);
    expect(h.setCachedAvailability).toHaveBeenCalledWith(
      buildAvailabilityCacheKey('video', 60, 4, FROZEN_NOW),
      slots,
    );
    // A confirmed write is not a failure — nothing is logged.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('honours the weeks query param in the Google seam horizon', async () => {
    await callGet('mode=in-person&duration=90&weeks=2');

    const [start, end, duration, mode] = h.getAvailableSlots.mock.calls[0] as [
      Date,
      Date,
      number,
      string,
    ];
    expect(end.getTime() - start.getTime()).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    expect(duration).toBe(90);
    expect(mode).toBe('in-person');
  });
});

// ===========================================================================
// 400 validation — exact French messages, and NO downstream call at all
// ===========================================================================

describe('GET /api/availability — validation (400)', () => {
  it.each([
    {
      name: 'missing mode',
      query: 'duration=60',
      expected:
        'Paramètre manquant : "mode" est obligatoire ("in-person" ou "video").',
    },
    {
      name: 'invalid mode',
      query: 'mode=phone&duration=60',
      expected:
        'Valeur invalide pour "mode" : "phone". Valeurs acceptées : "in-person", "video".',
    },
    {
      name: 'missing duration',
      query: 'mode=video',
      expected: 'Paramètre manquant : "duration" est obligatoire (60 ou 90).',
    },
    {
      name: 'invalid duration',
      query: 'mode=video&duration=75',
      expected:
        'Valeur invalide pour "duration" : "75". Valeurs acceptées : 60, 90.',
    },
    {
      name: 'weeks below minimum',
      query: 'mode=video&duration=60&weeks=0',
      expected:
        'Valeur invalide pour "weeks" : "0". Valeur attendue entre 1 et 8.',
    },
    {
      name: 'weeks above maximum',
      query: 'mode=video&duration=60&weeks=9',
      expected:
        'Valeur invalide pour "weeks" : "9". Valeur attendue entre 1 et 8.',
    },
  ])(
    '$name → 400 with the exact French message and zero downstream calls',
    async ({ query, expected }) => {
      const response = await callGet(query);

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toEqual({ error: expected });
      // Validation short-circuits BEFORE any I/O or cache interaction.
      expect(h.getAvailableSlots).not.toHaveBeenCalled();
      expect(h.getCachedAvailability).not.toHaveBeenCalled();
      expect(h.setCachedAvailability).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 503 — typed shared-stage error, ZERO cache writes (SC5, patient side)
// ===========================================================================

describe('GET /api/availability — typed upstream errors (SC5/SC7)', () => {
  it('CalendarSharedStageError → 503 with the French message and ZERO cache writes', async () => {
    // Cause carrying a (fake) credential-shaped payload: nothing from it may
    // reach the logs — only the safe message and 'unknown' fallback.
    h.getAvailableSlots.mockRejectedValue(
      new CalendarSharedStageError(
        'Échec du stage partagé availability-snapshot : requête Freebusy impossible.',
        { client_secret: 'SECRET_TOKEN' },
      ),
    );

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toEqual({
      error: 'Le service de disponibilités est temporairement indisponible.',
    });
    // SC5: an upstream error never persists an empty/failed availability.
    expect(h.setCachedAvailability).not.toHaveBeenCalled();
    // Sanitization: the raw cause payload never reaches the logs.
    const logged = consoleError.mock.calls
      .map(c => c.map(String).join(' '))
      .join('\n');
    expect(logged).not.toContain('SECRET_TOKEN');
  });

  it('unexpected non-GoogleCalendar error → 500 internal message, no cache write', async () => {
    h.getAvailableSlots.mockRejectedValue(new Error('boom'));

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toEqual({
      error:
        'Une erreur interne est survenue. Veuillez réessayer ultérieurement.',
    });
    expect(h.setCachedAvailability).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Cache HIT — re-filter by LIVE DB busy through the REAL shared filter
// ===========================================================================

describe('GET /api/availability — cache hit re-filtering (SC7)', () => {
  it('serves cached slots re-filtered by live dbBusy and never hits Google nor writes the cache', async () => {
    seedDbBusyAppointment();
    h.cachedSlots = [FREE_SLOT, BUSY_OVERLAPPED_SLOT];

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // The busy-overlapped cached slot is removed by the REAL filterSlotsByBusy
    // applied to the live DB busy window; the free slot survives.
    await expect(readJson(response)).resolves.toEqual({ slots: [FREE_SLOT] });
    expect(h.getCachedAvailability).toHaveBeenCalledWith(
      buildAvailabilityCacheKey('video', 60, 4, FROZEN_NOW),
    );
    expect(h.getAvailableSlots).not.toHaveBeenCalled();
    expect(h.setCachedAvailability).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Cache write failure — non-fatal 200, sanitized console.error (SC6)
// ===========================================================================

describe('GET /api/availability — cache write failures are non-fatal (SC6)', () => {
  it('a rejected cache write still returns 200 with the slots and logs a sanitized error', async () => {
    h.writeReject = new Error('blobs unavailable — SECRET_PAYLOAD');

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ slots: [FREE_SLOT] });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls
      .map(c => c.map(String).join(' '))
      .join('\n');
    expect(logged).toContain("Échec de l'écriture du cache");
    // The thrown error object/payload is never transported to the logs.
    expect(logged).not.toContain('SECRET_PAYLOAD');
  });

  it("a 'failed' CacheWriteResult still returns 200 with the slots and logs the failure", async () => {
    h.writeResult = 'failed';

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ slots: [FREE_SLOT] });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls
      .map(c => c.map(String).join(' '))
      .join('\n');
    expect(logged).toContain("Échec de l'écriture du cache");
  });

  it("a 'skipped-no-store' CacheWriteResult returns 200 silently", async () => {
    h.writeResult = 'skipped-no-store';

    const response = await callGet('mode=video&duration=60');

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toEqual({ slots: [FREE_SLOT] });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
