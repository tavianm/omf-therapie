---
issue: 36
tier: F-full
spec: artifacts/specs/36-google-calendar-production-ready-spec.md
status: draft
---

# Plan — #36 Google Calendar Production-Ready Integration

## Overview

5 slices of work, all backend. Agents: `backend-dev` (primary), `security-auditor` (T2), `tester` (final).

---

## Tasks

| ID | Description | Agent | Files | Dependencies | Parallel? |
|----|-------------|-------|-------|--------------|-----------|
| T1 | Migration SQL + TypeScript types | backend-dev | `supabase/migrations/004_google_calendar.sql`, `src/types/appointment.ts` | — | Y |
| T2 | Auth: persisted OAuth token rotation | backend-dev | `src/lib/google-calendar.ts` | T1 | N |
| T3 | Typed errors + retry helper | backend-dev | `src/lib/google-calendar.ts` | — | Y (with T1) |
| T4 | Event lifecycle functions (update/delete, reduce poll) | backend-dev | `src/lib/google-calendar.ts` | T3 | N |
| T5 | Call sites: store eventId + patch/delete on actions | backend-dev | `src/pages/api/appointments/[id].ts`, `src/pages/api/admin/appointments/index.ts` | T1, T4 | N |
| T6 | Cache module + integrate in availability + invalidate | backend-dev | `src/lib/calendar-cache.ts` (new), `src/pages/api/availability.ts`, `src/pages/api/appointments/[id].ts`, `src/pages/api/admin/appointments/index.ts` | T5 | N |
| T7 | Security audit (token storage, auth flow) | security-auditor | `src/lib/google-calendar.ts`, `src/pages/api/` | T2, T3 | Y (with T6) |
| T8 | Tests | tester | `src/lib/google-calendar.ts`, `src/pages/api/` | T6, T7 | N |

---

## Agent Slices

**backend-dev:** T1 → T2+T3 (T2 after T1; T3 parallel with T1) → T4 → T5 → T6
**security-auditor:** T7 (after T2, T3)
**tester:** T8 (after all)

---

## Detailed Task Specs

### T1 — Migration SQL + Types

**File: `supabase/migrations/004_google_calendar.sql`**
```sql
-- Token storage for OAuth rotation
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT 'therapist',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: only service role can access
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Link calendar events to appointments
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
```

**File: `src/types/appointment.ts`**
- Add `google_calendar_event_id?: string | null` to the `Appointment` interface

---

### T2 — Auth: Persisted OAuth Token Rotation

**Location:** `src/lib/google-calendar.ts`

Replace `buildOAuthClient()` with `getPersistedOAuthClient()`:

```typescript
async function getPersistedOAuthClient(): Promise<OAuth2Client> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // 1. Load from DB
  const { data, error } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('*')
    .eq('id', 'therapist')
    .single();

  let tokens = data;

  if (error || !tokens) {
    // 2. Bootstrap from env vars (first run)
    tokens = {
      id: 'therapist',
      access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? '',
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
      expiry_date: Date.now(),
    };
    await supabaseAdmin.from('google_oauth_tokens').upsert(tokens);
  }

  // 3. Proactive refresh: 5 min buffer
  if (tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const updated = {
        access_token: credentials.access_token!,
        // Persist rotated refresh_token if Google returns one (rotation policy)
        refresh_token: credentials.refresh_token ?? tokens.refresh_token,
        expiry_date: credentials.expiry_date ?? (Date.now() + 3600 * 1000),
        updated_at: new Date().toISOString(),
      };
      await supabaseAdmin.from('google_oauth_tokens')
        .update(updated)
        .eq('id', 'therapist');
      oauth2Client.setCredentials(credentials);
      return oauth2Client;
    } catch (err) {
      // invalid_grant = consent revoked — alert admin
      if ((err as any)?.response?.data?.error === 'invalid_grant') {
        // TODO: send admin alert email
        throw new CalendarAuthError('OAuth consent revoked — re-authorize in Google Cloud Console');
      }
      throw new CalendarNetworkError('Token refresh failed', err);
    }
  }

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });
  return oauth2Client;
}
```

**Notes:**
- `resolveCalendarAuth()` calls `getPersistedOAuthClient()` as primary strategy
- No race condition mitigation in V1 (single therapist, concurrency is minimal; TODO comment for future DB lock)
- Keep `buildServiceAccountClient()` unchanged as fallback

---

### T3 — Typed Errors + Retry

**Location:** `src/lib/google-calendar.ts`

Keep `GoogleCalendarError` as **base class** (preserves all existing `instanceof` checks in availability.ts and google-calendar.ts). Typed subclasses extend it:

```typescript
// Keep existing class, add cause
export class GoogleCalendarError extends Error {
  constructor(message: string, public cause?: unknown) { super(message); this.name = 'GoogleCalendarError'; }
}

export class CalendarAuthError extends GoogleCalendarError {
  readonly type = 'CalendarAuthError';
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarAuthError'; }
}

export class CalendarPermissionError extends GoogleCalendarError {
  readonly type = 'CalendarPermissionError';
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarPermissionError'; }
}

export class CalendarQuotaError extends GoogleCalendarError {
  readonly type = 'CalendarQuotaError';
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarQuotaError'; }
}

export class CalendarNetworkError extends GoogleCalendarError {
  readonly type = 'CalendarNetworkError';
  constructor(message: string, cause?: unknown) { super(message, cause); this.name = 'CalendarNetworkError'; }
}

function parseGoogleError(err: unknown): Error {
  const status = (err as any)?.response?.status ?? (err as any)?.code;
  if (status === 401) return new CalendarAuthError('Authentication failed', err);
  if (status === 403) return new CalendarPermissionError('Calendar access denied', err);
  if (status === 429) return new CalendarQuotaError('Google API quota exceeded', err);
  return new CalendarNetworkError('Calendar API error', err);
}

async function withCalendarRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const parsed = parseGoogleError(err);
      lastError = parsed;
      if (parsed instanceof CalendarAuthError || parsed instanceof CalendarPermissionError) {
        throw parsed; // No retry for auth/permission errors
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError!;
}
```

---

### T4 — Event Lifecycle Functions

**Location:** `src/lib/google-calendar.ts`

Changes:
1. **Reduce `pollMeetLink` attempts:** `maxAttempts` from 10 to 3 (4.5s max vs 15s)
2. **New `updateCalendarEvent(eventId, patch)`:**
```typescript
export async function updateCalendarEvent(
  eventId: string,
  patch: { start?: Date; end?: Date; summary?: string }
): Promise<void> {
  return withCalendarRetry(async () => {
    const auth = await resolveCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const body: calendar_v3.Schema$Event = {};
    if (patch.start) body.start = { dateTime: patch.start.toISOString(), timeZone: TIMEZONE };
    if (patch.end) body.end = { dateTime: patch.end.toISOString(), timeZone: TIMEZONE };
    if (patch.summary) body.summary = patch.summary;
    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: body,
      sendUpdates: 'all',
    });
  });
}
```

3. **New `deleteCalendarEvent(eventId)`:**
```typescript
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  return withCalendarRetry(async () => {
    const auth = await resolveCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });
  });
}
```

4. **`createCalendarEvent` now returns `eventId`** (it already returns it, but add it to the return type explicitly)

---

### T5 — Call Sites: Store eventId + patch/delete

**File: `src/pages/api/appointments/[id].ts`**

| Action | Change |
|--------|--------|
| `confirm` (online — creates Meet event) | **Guard:** if `appt.google_calendar_event_id` already exists, skip `createCalendarEvent()` (idempotency on retry). After creation, await store of `google_calendar_event_id`. |
| `decline` | After DB update, if `appt.google_calendar_event_id` exists → `await deleteCalendarEvent(id).catch(console.error)` (awaited — no fire-and-forget in serverless) |
| `reschedule` (therapist proposes) | DB-only — do NOT touch Calendar (proposal pending patient acceptance) |
| `accept_reschedule` (in-person) | **Guard:** if `google_calendar_event_id` exists → `await updateCalendarEvent(id, {start: accepted_date, end})`, else → `createCalendarEvent()` + store ID |
| `cancel_reschedule` | DB-only rollback — no Calendar change needed |

**File: `src/pages/api/admin/appointments/index.ts`**

- **Guard:** if `appt.google_calendar_event_id` already exists, skip `createCalendarEvent()` (idempotency on retry)
- After `createCalendarEvent()` call → await store of returned `eventId` in appointment row

---

### T6 — Cache

**New file: `src/lib/calendar-cache.ts`**
```typescript
import { getStore } from '@netlify/blobs';
import type { TimeSlot } from './google-calendar';

function getAvailabilityStore() {
  try {
    return getStore('calendar-availability');
  } catch {
    return null; // not available in local astro dev
  }
}

export async function getCachedAvailability(key: string): Promise<TimeSlot[] | null> {
  const store = getAvailabilityStore();
  if (!store) return null;
  try {
    const data = await store.getWithMetadata(key, { type: 'json' });
    if (!data) return null;
    const { metadata } = data as any;
    if (metadata?.expiresAt && Date.now() > metadata.expiresAt) return null;
    return (data as any).data as TimeSlot[];
  } catch {
    return null;
  }
}

export async function setCachedAvailability(
  key: string,
  slots: TimeSlot[],
  ttlSeconds = 600
): Promise<void> {
  const store = getAvailabilityStore();
  if (!store) return;
  try {
    await store.setJSON(key, slots, {
      metadata: { expiresAt: Date.now() + ttlSeconds * 1000 }
    });
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function invalidateAvailabilityCache(): Promise<void> {
  const store = getAvailabilityStore();
  if (!store) return;
  try {
    const { blobs } = await store.list();
    await Promise.allSettled(blobs.map(b => store.delete(b.key)));
  } catch {
    // Non-fatal
  }
}
```

**File: `src/pages/api/availability.ts`**
- Compute stable cache key: `available:${mode}:${duration}:${weekStart}` where `weekStart` = Monday of the week containing `startDate`, formatted as `YYYY-MM-DD` (Paris time). Do NOT include raw `Date.now()` in the key.
- Before `getAvailableSlots()`: compute key → check cache → return if hit
- After `getAvailableSlots()`: `await setCachedAvailability(key, slots).catch(() => {})` (awaited, never blocks response on error)

**Files: `appointments/[id].ts` + `admin/appointments/index.ts`**
- After every mutating DB operation (confirm, decline, reschedule, accept_reschedule):
  ```ts
  await invalidateAvailabilityCache().catch(console.error);
  ```
  (awaited — Netlify functions don't reliably execute fire-and-forget promises after response is sent)

---

## Agent Sequence

```
T1 + T3 (parallel, no deps)
     ↓
T2 (needs T1 for DB) | T4 (needs T3 for typed errors)
     ↓                        ↓
               T5 (needs T1 + T4)
                     ↓
               T6 (needs T5 for call sites)
                     ↓
          T7 (security audit) ← can run after T2,T3
                     ↓
               T8 (tests — last)
```

In practice for sequential execution: T1 → T3 → T2 → T4 → T5 → T6 → T7 → T8

---

## Quality Gate

```bash
npm run lint && npm run build
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Supabase for token storage | Already in stack, no new infra |
| `@netlify/blobs` for cache | Bundled via `@astrojs/netlify`, zero config |
| No DB lock on token refresh | Single therapist, near-zero concurrency risk; rotated `refresh_token` always persisted from Google credentials; TODO for future |
| Await cache invalidation | Netlify serverless kills dangling promises after response — all side effects must be awaited |
| Reschedule = DB-only until accept | Prevents Calendar from drifting if patient cancels/rejects the proposal |
| Cache key: `available:${mode}:${duration}:${weekStart}` | Stable key derived from business inputs only — never includes raw timestamps |
| Idempotency guard on createCalendarEvent | Skip creation if `google_calendar_event_id` already set — safe on retries/webhook replays |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Token refresh race (concurrent requests) | 5min buffer reduces frequency; rotated `refresh_token` always persisted; TODO: DB advisory lock |
| `@netlify/blobs` not available in `astro dev` | `getAvailabilityStore()` wraps `getStore()` in try/catch → returns `null` → cache no-op; also disabled when `GOOGLE_CALENDAR_MOCK=true` |
| `invalid_grant` on bootstrap | Fails loudly with `CalendarAuthError`; deployment checklist must include `GOOGLE_OAUTH_REFRESH_TOKEN` |
| Netlify function timeout on Meet polling | Reduced from 15s (10×1.5s) to 4.5s max (3×1.5s) |
| Duplicate calendar events on retry | Guard: check `google_calendar_event_id` before `createCalendarEvent()` at every call site |
| `CreateAppointmentData` accidentally requiring new field | Add `google_calendar_event_id?: string \| null` only to base `Appointment` interface; omit from `CreateAppointmentData` |
