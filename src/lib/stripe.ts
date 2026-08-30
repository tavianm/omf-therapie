/**
 * Client Stripe + helpers Payment Links — OMF Thérapie
 *
 * Dépendance à installer :
 *   npm add stripe
 */

import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Lazy initialization — this module must be importable from runtimes where
// `import.meta.env` is undefined (Netlify Functions Node.js, cf. resend.ts #98).
// The Stripe client and mock flag resolve on first use, not on module load.
// `process.env` is the only env source available in the cron runtime.
// ---------------------------------------------------------------------------

function getStripeKey(): string {
  // Guarded access (mirror of `readEnv` in google-calendar.ts): the optional
  // chaining keeps this importable in runtimes where `import.meta.env` is
  // undefined (Netlify scheduled functions — plain Node bundle, cf. #98/#126).
  return (
    (import.meta as { env?: Record<string, string | undefined> }).env
      ?.STRIPE_SECRET_KEY ??
    process.env.STRIPE_SECRET_KEY ??
    ''
  );
}

let cachedStripe: Stripe | null | undefined;

/** Instance Stripe (lazy) — null si STRIPE_SECRET_KEY est absente */
export function getStripe(): Stripe | null {
  if (cachedStripe !== undefined) return cachedStripe;
  const stripeKey = getStripeKey();
  cachedStripe = stripeKey
    ? new Stripe(stripeKey, {
        // Explicitly pin the API version literal to the live account's pinned version
        // (Dashboard → Developers → API version). stripe@22 bundles the
        // "2026-06-24.dahlia" types; our account is still on "2024-12-18.acacia".
        // Stripe pins requests to the account version regardless of this value, so
        // the literal documents intent; the @ts-expect-error bridges the SDK-type
        // drift and self-invalidates if the literal ever matches LatestApiVersion.
        // To upgrade: bump the account version first, verify response shapes, then
        // set this literal to match (the @ts-expect-error will drop automatically).
        // @ts-expect-error — account version differs from bundled LatestApiVersion
        apiVersion: '2024-12-18.acacia',
      })
    : null;
  if (!cachedStripe) {
    console.warn('[stripe] ⚠️  STRIPE_SECRET_KEY est absent. Les paiements Stripe échoueront.');
  }
  return cachedStripe;
}

/** True when running in dev/test with placeholder (or missing) Stripe keys */
export function isStripeMock(): boolean {
  const stripeKey = getStripeKey();
  return !stripeKey || stripeKey === 'sk_test_placeholder' || stripeKey.startsWith('sk_test_placeholder');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePaymentLinkParams {
  appointmentId: string;
  patientEmail: string;
  patientName: string;
  /** Montant en centimes */
  amount: number;
  /** Description affichée sur la page de paiement */
  description: string;
  /** URL de redirection après paiement réussi */
  successUrl: string;
}

export interface PaymentLinkResult {
  id: string;
  url: string;
}

const CHECKOUT_SESSION_PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

function withQueryParam(url: string, key: string, value: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    const hasQuery = url.includes('?');
    const separator = hasQuery ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

/**
 * Ensure Stripe redirect URL always carries checkout session context.
 * This avoids landing on /rdv/merci without session identifier.
 */
export function buildStripeSuccessUrl(successUrl: string): string {
  const withSource = withQueryParam(successUrl, 'source', 'payment-success');
  return withQueryParam(withSource, 'session_id', CHECKOUT_SESSION_PLACEHOLDER);
}

// ---------------------------------------------------------------------------
// Helper principal
// ---------------------------------------------------------------------------

/**
 * Crée un Payment Link Stripe one-time pour un rendez-vous vidéo.
 *
 * Utilise l'API Price + PaymentLink (pas Checkout Session) pour générer
 * un lien stable envoyable par email.
 */
export async function createAppointmentPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<PaymentLinkResult> {
  const { appointmentId, amount, description, successUrl } = params;
  const redirectUrl = buildStripeSuccessUrl(successUrl);

  // Dev/test bypass: return a mock payment link when Stripe key is placeholder
  if (isStripeMock()) {
    console.warn('[stripe] 🔧 Mode dev — lien de paiement simulé (clé Stripe placeholder)');
    const mockUrl = withQueryParam(
      withQueryParam(redirectUrl, 'mock', '1'),
      'appointment_id',
      appointmentId,
    );
    return {
      id: `mock_pl_${appointmentId}`,
      url: mockUrl,
    };
  }

  const client = getStripe();
  if (!client) {
    throw new Error('Stripe client non initialisé — STRIPE_SECRET_KEY manquante');
  }

  // 1. Créer un prix one-time
  const price = await client.prices.create({
    unit_amount: amount,
    currency: 'eur',
    product_data: {
      name: description,
    },
  });

  // 2. Créer le Payment Link
  const paymentLink = await client.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    after_completion: {
      type: 'redirect',
      redirect: { url: redirectUrl },
    },
    // Metadata propagated to the Checkout Session's PaymentIntent.
    payment_intent_data: {
      metadata: { appointment_id: appointmentId },
    },
    metadata: {
      appointment_id: appointmentId,
    },
    customer_creation: 'always',
    invoice_creation: { enabled: true },
  });

  return {
    id: paymentLink.id,
    url: paymentLink.url,
  };
}
