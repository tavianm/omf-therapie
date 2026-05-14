/**
 * Client Stripe + helpers Payment Links — OMF Thérapie
 *
 * Dépendance à installer :
 *   npm add stripe
 */

import Stripe from 'stripe';

const stripeKey = import.meta.env.STRIPE_SECRET_KEY ?? '';

if (!stripeKey) {
  console.warn('[stripe] ⚠️  STRIPE_SECRET_KEY est absent. Les paiements Stripe échoueront.');
}

/** True when running in dev/test with placeholder Stripe keys */
export const isStripeMock = !stripeKey || stripeKey === 'sk_test_placeholder' || stripeKey.startsWith('sk_test_placeholder');

/** Instance Stripe singleton */
export const stripe: Stripe = new Stripe(stripeKey, {
  apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
});

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
  if (isStripeMock) {
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

  // 1. Créer un prix one-time
  const price = await stripe.prices.create({
    unit_amount: amount,
    currency: 'eur',
    product_data: {
      name: description,
    },
  });

  // 2. Créer le Payment Link
  const paymentLink = await stripe.paymentLinks.create({
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
