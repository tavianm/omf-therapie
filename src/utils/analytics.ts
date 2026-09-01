declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Estimated session value by appointment type (90-min base price, EUR) */
export const APPOINTMENT_ESTIMATED_VALUE: Record<string, number> = {
  individual: 65,
  couple: 90,
  family: 100,
};

/**
 * Fire a GA4 event via the main-thread gtag shim.
 * Works from React islands — gtag is forwarded to the Partytown worker via dataLayer.
 * No-op outside browser or when gtag is not loaded.
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }
}
