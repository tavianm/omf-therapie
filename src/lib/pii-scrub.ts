/**
 * Pure PII scrubber — shared by server, client, and (logically) cron.
 *
 * This module has NO Sentry imports on purpose. `@sentry/node`'s `Event` is
 * server-only and `@sentry/browser`'s `Event` is browser-only; neither can be
 * imported by the other side. To share one scrubber across both runtimes we
 * operate on a structural `ScrubbableEvent` type (the subset of fields the
 * scrubber inspects), which is assignable from both SDKs' Event types.
 *
 * Consumers:
 *   - src/lib/sentry.server.ts (server, @sentry/node)
 *   - src/layouts/Layout.astro   (browser, @sentry/browser)
 *   - netlify/functions/_lib/sentry.ts duplicates this logic (cron bundler
 *     cannot resolve src/lib) — keep in sync; the parity gap is tracked as a
 *     separate medium finding.
 */

/**
 * Keys that may carry patient-identifying or otherwise sensitive data.
 * Redacted from breadcrumbs, extra, and request body before any event leaves
 * the process.
 *
 * Kept in sync with netlify/functions/_lib/sentry.ts (cron copy). Add new
 * sensitive columns here AND there.
 */
const PII_KEYS = [
  // Real appointment columns (supabase/migrations/001_init.sql)
  'patient_name',
  'patient_email',
  'patient_phone',
  'patient_postal_code',
  'patient_city',
  'patient_reason',
  'therapist_notes',
  // Aliases / generic key forms (camelCase, bare)
  'patientReason',
  'email',
  'phone',
  'message',
  'notes',
  // Operator PII (therapist/practitioner) — calendar heartbeat logs adminEmail
  'adminEmail',
  'admin_email',
  // Video session link (sensitive: meeting URL)
  'video_link',
  'videoLink',
] as const;

const REDACTED = '[REDACTED]';

/**
 * Structural subset of a Sentry Event that the scrubber reads/writes. Both
 * `@sentry/node`'s `Event`/`ErrorEvent` and `@sentry/browser`'s are assignable
 * to this (all scrubbed fields are optional on every variant).
 *
 * `request.data` is typed `unknown` because both SDKs type it that way
 * (`RequestEventData.data?: unknown`) — we narrow to `string` at runtime
 * before parsing as JSON. We deliberately do NOT add an index signature:
 * `ErrorEvent` has a literal `type` field that an index signature would clash
 * with, breaking assignability in both directions.
 */
export interface ScrubbableEvent {
  request?: { data?: unknown };
  extra?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
}

/** True when `v` is a record we can walk for PII keys. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-walk a value redacting PII keys on every nested record. */
function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      clone[k] = (PII_KEYS as readonly string[]).includes(k) ? REDACTED : redactDeep(v);
    }
    return clone;
  }
  return value;
}

/** Best-effort redaction inside a JSON string body. */
function redactJsonString(body: string): string {
  // Avoid throwing on malformed bodies — this is defensive, not authoritative.
  try {
    const parsed = JSON.parse(body);
    const scrubbed = redactDeep(parsed);
    return JSON.stringify(scrubbed);
  } catch {
    return body;
  }
}

/**
 * Pure PII scrubber applied to every outbound Sentry event via `beforeSend`.
 * Walks breadcrumbs, extra, and request body (deep) and replaces PII keys
 * with `[REDACTED]`. Returns a new event (does not mutate the input).
 *
 * Breadcrumbs use the same deep walk as `extra` so nested forwarded fields
 * (e.g. `logger.error('x', { body: { email } })`) are redacted at every
 * depth, not just the top level.
 *
 * Generic over `T` (defaulting to `ScrubbableEvent`) so callers can pass a
 * Sentry SDK `ErrorEvent` and get the same `ErrorEvent` back — no cast needed
 * at the call site. `T extends ScrubbableEvent` holds because every Sentry
 * Event variant makes all scrubbed fields optional.
 */
export function scrubPii<T extends ScrubbableEvent = ScrubbableEvent>(
  event: T,
): T {
  // Operate on a shallow copy; we only replace the top-level scrubbed branches
  // with new objects, leaving the rest of `event` by reference. The cast back
  // to `T` is sound: the branches we mutate (request/extra/breadcrumbs) keep
  // the structural shape `ScrubbableEvent` describes, and all other fields
  // pass through unchanged.
  const next = { ...event } as T;

  const request = (next as ScrubbableEvent).request;
  if (request) {
    const reqCopy = { ...request };
    if (typeof request.data === 'string') {
      reqCopy.data = redactJsonString(request.data);
    }
    (next as ScrubbableEvent).request = reqCopy;
  }

  const extra = (next as ScrubbableEvent).extra;
  if (extra) {
    (next as ScrubbableEvent).extra = redactDeep(extra) as Record<string, unknown>;
  }

  const breadcrumbs = (next as ScrubbableEvent).breadcrumbs;
  if (Array.isArray(breadcrumbs)) {
    (next as ScrubbableEvent).breadcrumbs = breadcrumbs.map((crumb) => {
      const copy = { ...crumb };
      if (isRecord(copy.data)) {
        // Deep walk: breadcrumb data often holds nested structured fields
        // forwarded from the logger, so a shallow redact is not enough.
        copy.data = redactDeep(copy.data) as Record<string, unknown>;
      }
      return copy;
    });
  }

  return next;
}
