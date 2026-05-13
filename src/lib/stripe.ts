/**
 * Client Stripe + helpers Payment Links — OMF Thérapie
 *
 * Dépendance à installer :
 *   npm add stripe
 */

// @ts-expect-error — stripe pas encore installé, sera résolu à l'install
import Stripe from 'stripe';

if (!import.meta.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe] ⚠️  STRIPE_SECRET_KEY est absent. Les paiements Stripe échoueront.');
}

/** Instance Stripe singleton */
export const stripe: Stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY ?? '', {
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
      redirect: { url: successUrl },
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
