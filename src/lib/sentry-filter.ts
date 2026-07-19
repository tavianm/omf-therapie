/**
 * Pure Sentry event filter — drops events that originate from browser
 * extensions, third-party injected scripts, or other non-app code.
 *
 * Like pii-scrub.ts, this module has NO Sentry imports on purpose. Both
 * `@sentry/node` and `@sentry/browser` Event types are structurally
 * assignable to `FilterableEvent`, so the same filter runs server-side and
 * client-side.
 *
 * Why a custom filter instead of the SDK's `ignoreErrors` / `denyUrls`:
 *   - `denyUrls` only matches the top-level `event.request.url`, NOT the
 *     frames inside exception stacktraces. Extension errors surface as
 *     frames whose `filename` is `webkit-masked-url://hidden/`,
 *     `chrome-extension://…`, or `moz-extension://…`, while `request.url`
 *     is still our own origin — so `denyUrls` would let them through.
 *   - `ignoreErrors` matches by message substring. Extension error messages
 *     are unstable (they describe internal extension state such as
 *     `response.cashbackReminder`), so message-matching is brittle.
 *   - Returning `null` from `beforeSend` is the Sentry-blessed way to drop
 *     an event entirely (no rate-limit consumption, no re-grouping).
 *
 * Consumers:
 *   - src/lib/sentry.server.ts (server, @sentry/node) — wraps scrubPii
 *   - src/layouts/Layout.astro                    (browser, @sentry/browser)
 *
 * Real-world example this guards against (seen in production 2026-07-19):
 *   TypeError: undefined is not an object (evaluating 'response.cashbackReminder')
 *   at onResponse (webkit-masked-url://hidden/:99:15)
 *   from Mobile Safari / iOS — a cashback browser extension (iGraal/Pouch-like)
 *   intercepting fetch responses. Not our code, not actionable.
 */

/**
 * Filename prefixes / exact hosts that identify non-app frames.
 *
 * - `chrome-extension://`, `moz-extension://`, `safari-web-extension://`:
 *   browser extensions of any kind. Their errors are never actionable by us.
 * - `webkit-masked-url://`: Safari/WKWebView masks extension/script URLs in
 *   stacktraces for privacy. Its presence in a frame is itself the signal —
 *   real app frames have real URLs (https://omf-therapie.fr/_astro/…).
 * - `extensions/::AABB…`: Safari's other masking form for extensions.
 */
const EXTENSION_FRAME_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
  'webkit-masked-url://',
  'extensions/',
] as const;

/**
 * Message substrings characteristic of well-known extension/network-agent
 * noise. Matched case-insensitively against the event message and the
 * exception values. Each entry must be specific enough not to swallow real
 * app errors.
 *
 * - `cashbackReminder`: iGraal/Pouch-family cashback extension polling for
 *   partner cashback info on every page's XHR responses.
 * - `ResizeObserver loop`: harmless browser-spec warning, never actionable.
 *   (Browsers fire it from a microtask, not from app code.)
 */
const NOISE_MESSAGE_SUBSTRINGS = [
  'cashbackreminder',
  'resizeobserver loop',
] as const;

/**
 * Structural subset of a Sentry Event that the filter inspects. Both SDKs'
 * Event/ErrorEvent types are assignable to this.
 */
export interface FilterableEvent {
  message?: string;
  exception?: {
    values?: Array<{
      value?: string;
      stacktrace?: {
        frames?: Array<{ filename?: string }>;
      };
    }>;
  };
}

/**
 * True when any frame filename in the event's exception stacktrace matches
 * an extension/non-app prefix. Walks ALL exception values + frames (an event
 * may carry several exceptions via `exception.values[]`).
 */
function hasExtensionFrame(event: FilterableEvent): boolean {
  const values = event.exception?.values;
  if (!Array.isArray(values)) return false;
  for (const ex of values) {
    const frames = ex?.stacktrace?.frames;
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      const filename = frame?.filename;
      if (typeof filename !== 'string') continue;
      // Lowercase for case-insensitive prefix match. Filenames are URLs so
      // the scheme/host portion is case-insensitive in practice.
      const lower = filename.toLowerCase();
      if (
        EXTENSION_FRAME_PREFIXES.some((prefix) => lower.startsWith(prefix))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when the event's message or any exception value contains a known
 * noise substring (case-insensitive).
 */
function hasNoiseMessage(event: FilterableEvent): boolean {
  const candidates: string[] = [];
  if (typeof event.message === 'string') candidates.push(event.message);
  const values = event.exception?.values;
  if (Array.isArray(values)) {
    for (const ex of values) {
      if (typeof ex?.value === 'string') candidates.push(ex.value);
    }
  }
  if (candidates.length === 0) return false;
  const hay = candidates.join('\n').toLowerCase();
  return NOISE_MESSAGE_SUBSTRINGS.some((sub) => hay.includes(sub));
}

/**
 * Decide whether an outbound Sentry event should be dropped.
 *
 * Returns `true` for events that originate from browser extensions or other
 * known noise sources — callers should return `null` from `beforeSend` when
 * this returns `true` (the Sentry-blessed drop signal).
 *
 * Generic over `T` so callers can pass a full SDK Event and keep its type.
 */
export function shouldDropEvent<T extends FilterableEvent = FilterableEvent>(
  event: T,
): boolean {
  return hasExtensionFrame(event) || hasNoiseMessage(event);
}
