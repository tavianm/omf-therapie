/**
 * Template 6 — PaymentRequest
 * Destinataire : Patient (demande de paiement — séances vidéo)
 * Sujet : "Prépaiement de votre séance — [Date]"
 */

import { Button, Hr, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { getTypeLabel } from '../lib/pricing';
import {
  COLORS,
  RecapRow,
  S,
  SectionDivider,
  formatDateFR,
  formatDateOnlyFR,
  formatPrice,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  scheduledAt: string;
  appointmentType: 'individual' | 'couple' | 'family';
  duration: 60 | 90;
  finalPrice: number; // centimes
  stripePaymentUrl: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function PaymentRequest({
  patientName,
  scheduledAt,
  appointmentType,
  duration,
  finalPrice,
  stripePaymentUrl,
  expiresAt,
}: Props) {
  return (
    <BaseLayout preview={`Finalisez votre réservation — prépaiement de ${formatPrice(finalPrice)}`}>

      {/* Titre */}
      <Text style={S.title}>Finalisez votre réservation 💳</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Votre séance de téléconsultation du{' '}
        <strong>{formatDateFR(scheduledAt)}</strong> est presque confirmée !
        Pour finaliser votre réservation, un prépaiement sécurisé en ligne est
        demandé.
      </Text>

      {/* Explication rassurante */}
      <Section style={S.infoBox}>
        <Text style={{ ...S.infoText, marginBottom: '8px' }}>
          🔒 <strong>Paiement 100 % sécurisé via Stripe</strong>
        </Text>
        <Text style={S.infoText}>
          Vos données bancaires ne sont jamais stockées sur notre site. Stripe
          est un service de paiement certifié PCI-DSS, utilisé par des millions
          d'entreprises dans le monde.
        </Text>
      </Section>

      {/* Récapitulatif */}
      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Récapitulatif de votre séance</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Type"          value={getTypeLabel(appointmentType)} />
        <RecapRow label="Mode"          value="Téléconsultation" />
        <RecapRow label="Date et heure" value={formatDateFR(scheduledAt)} />
        <RecapRow label="Durée"         value={`${duration} minutes`} />
        <RecapRow label="Montant"       value={formatPrice(finalPrice)} />
      </Section>

      {/* Montant en évidence */}
      <Text style={S.highlight}>
        {formatPrice(finalPrice)}
      </Text>
      <Text style={{ ...S.small, textAlign: 'center' as const, marginBottom: '8px' }}>
        Montant total à régler
      </Text>

      {/* CTA principal */}
      <Section style={{ ...S.btnWrapper, margin: '16px 0 8px' }}>
        <Button href={stripePaymentUrl} style={{
          ...S.btnPrimary,
          fontSize:  '17px',
          padding:   '16px 40px',
          boxShadow: '0 2px 8px rgba(212,169,106,0.35)',
        }}>
          Payer {formatPrice(finalPrice)} en ligne →
        </Button>
      </Section>

      {/* Expiration */}
      {expiresAt && (
        <Text style={{ ...S.small, textAlign: 'center' as const, color: COLORS.sage600 }}>
          ⏳ Ce lien de paiement est valable jusqu'au{' '}
          <strong>{formatDateOnlyFR(expiresAt)}</strong>.
        </Text>
      )}

      <SectionDivider />

      {/* Garantie remboursement */}
      <Section style={S.warnBox}>
        <Text style={{ ...S.infoText, color: COLORS.sage800 }}>
          💚 <strong>Annulation sans frais :</strong> en cas d'annulation au
          moins <strong>48h avant</strong> votre séance, vous serez intégralement
          remboursé. Pour toute annulation, contactez-nous à{' '}
          <Link href="mailto:contact@omf-therapie.fr" style={{ color: COLORS.mint600 }}>
            contact@omf-therapie.fr
          </Link>
          .
        </Text>
      </Section>

      {/* Contact */}
      <Text style={{ ...S.body, marginTop: '16px' }}>
        Des questions sur le paiement ou votre séance ? N'hésitez pas à nous
        écrire à{' '}
        <Link href="mailto:contact@omf-therapie.fr" style={{ color: COLORS.mint600 }}>
          contact@omf-therapie.fr
        </Link>{' '}
        ou à nous appeler au{' '}
        <Link href="tel:+33650331853" style={{ color: COLORS.mint600 }}>
          06 50 33 18 53
        </Link>
        .
      </Text>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic' }}>
        À très bientôt,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
