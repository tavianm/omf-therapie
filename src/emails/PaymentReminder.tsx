/**
 * Template — PaymentReminder
 * Destinataire : Patient (rappel J-1 paiement en attente)
 * Sujet : "⚠️ Action requise : réglez votre séance de demain"
 *
 * Envoyé par send-reminders quand l'appointment est encore en statut
 * payment_pending la veille du rendez-vous.
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
  formatPrice,
  formatTimeFR,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  appointmentType: 'individual' | 'couple' | 'family';
  scheduledAt: string;
  duration: number;
  finalPrice: number; // centimes
  stripePaymentUrl: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function PaymentReminder({
  patientName,
  appointmentType,
  scheduledAt,
  duration,
  finalPrice,
  stripePaymentUrl,
}: Props) {
  return (
    <BaseLayout preview={`Action requise : réglez votre séance de demain à ${formatTimeFR(scheduledAt)}`}>

      {/* Badge "Paiement en attente" */}
      <Section style={{
        backgroundColor: '#fff8ee',
        border:          `1px solid ${COLORS.accent}`,
        borderRadius:    '20px',
        padding:         '5px 16px',
        display:         'inline-block',
        margin:          '0 0 16px',
      }}>
        <Text style={{
          fontFamily:    'Inter, Arial, sans-serif',
          fontSize:      '12px',
          fontWeight:    '600',
          color:         '#a0692a',
          margin:        '0',
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
        }}>
          ⚠️ Paiement en attente
        </Text>
      </Section>

      {/* Titre */}
      <Text style={S.title}>Votre séance de demain n'est pas encore confirmée</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Votre rendez-vous avec Oriane Montabonnet est prévu <strong>demain</strong>,
        mais votre paiement n'a pas encore été reçu. Pour que votre séance soit
        confirmée, merci de finaliser le règlement dès que possible via le lien
        ci-dessous.
      </Text>

      {/* Heure en évidence */}
      <Section style={{
        ...S.summaryBox,
        textAlign: 'center' as const,
        padding:   '28px 24px',
        margin:    '20px 0',
      }}>
        <Text style={{ ...S.label, textAlign: 'center' as const, marginBottom: '8px' }}>
          Rendez-vous demain à
        </Text>
        <Text style={{
          fontFamily:  '"Cormorant Garamond", Georgia, serif',
          fontSize:    '42px',
          fontWeight:  '600',
          color:       COLORS.sage800,
          margin:      '0 0 4px',
          lineHeight:  '1',
        }}>
          {formatTimeFR(scheduledAt)}
        </Text>
        <Text style={{ ...S.small, textAlign: 'center' as const, margin: '8px 0 0' }}>
          {formatDateFR(scheduledAt)} · {duration} minutes · Téléconsultation
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

      {/* Sécurité paiement */}
      <Section style={S.infoBox}>
        <Text style={{ ...S.infoText, marginBottom: '8px' }}>
          🔒 <strong>Paiement 100 % sécurisé via Stripe</strong>
        </Text>
        <Text style={S.infoText}>
          Vos données bancaires ne sont jamais stockées sur notre site. Stripe
          est un service de paiement certifié PCI-DSS.
        </Text>
      </Section>

      {/* Montant en évidence */}
      <Text style={S.highlight}>{formatPrice(finalPrice)}</Text>
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
          Payer {formatPrice(finalPrice)} et confirmer ma séance →
        </Button>
      </Section>

      <Text style={{ ...S.small, textAlign: 'center' as const, color: COLORS.sage600, marginBottom: '20px' }}>
        Lien direct :{' '}
        <Link href={stripePaymentUrl} style={{ color: COLORS.mint600, fontSize: '13px' }}>
          {stripePaymentUrl}
        </Link>
      </Text>

      <SectionDivider />

      {/* Annulation sans frais */}
      <Section style={S.warnBox}>
        <Text style={{ ...S.infoText, color: COLORS.sage800 }}>
          💚 <strong>Annulation sans frais :</strong> si vous ne souhaitez plus
          maintenir ce rendez-vous, contactez-nous avant ce soir au{' '}
          <Link href="tel:+33650331853" style={{ color: COLORS.mint600 }}>
            06 50 33 18 53
          </Link>{' '}
          ou à{' '}
          <Link href="mailto:contact@omf-therapie.fr" style={{ color: COLORS.mint600 }}>
            contact@omf-therapie.fr
          </Link>
          .
        </Text>
      </Section>

      {/* Contact */}
      <Text style={{ ...S.body, marginTop: '16px' }}>
        Des questions sur le paiement ou votre séance ? N'hésitez pas à nous
        contacter, nous vous répondrons dans les plus brefs délais.
      </Text>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic' }}>
        À demain,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
