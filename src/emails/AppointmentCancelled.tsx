/**
 * Template — AppointmentCancelled
 * Destinataire : Patient
 * Sujet : "Votre rendez-vous a été annulé"
 *
 * Deux variantes :
 *   - sans avoir : notification simple d'annulation.
 *   - avec avoir  : mention explicite d'un AVOIR INTERNE (jamais le mot
 *                   « remboursement »), valide en permanence, à utiliser en
 *                   contactant la thérapeute (aucune UI patient pour les avoirs).
 */

import { Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import {
  COLORS,
  S,
  SectionDivider,
  formatDateOnlyFR,
  formatPrice,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  scheduledAt: string;
  /** Vrai si un avoir a été émis (annulation d'un RDV payé en cash). */
  hasCredit: boolean;
  /** Montant de l'avoir en centimes (affiché seulement si hasCredit). */
  creditAmount?: number;
  /** Mode de séance (pour rappel présentiel/téléconsultation). */
  appointmentMode?: 'in-person' | 'video';
  /** Message optionnel de la thérapeute. */
  therapistNote?: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentCancelled({
  patientName,
  scheduledAt,
  hasCredit,
  creditAmount,
  appointmentMode,
  therapistNote,
}: Props) {
  return (
    <BaseLayout preview="Votre rendez-vous a été annulé — OMF Thérapie">

      {/* Titre */}
      <Text style={S.title}>Votre rendez-vous a été annulé</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Votre rendez-vous prévu le{' '}
        <strong>{formatDateOnlyFR(scheduledAt)}</strong>
        {appointmentMode === 'video' ? ' (téléconsultation)' : ' (au cabinet)'}{' '}
        a été annulé par Oriane.
      </Text>

      {/* Bloc AVOIR — formulation soigneuse, jamais « remboursement » */}
      {hasCredit && creditAmount != null && creditAmount > 0 && (
        <Section style={{
          ...S.summaryBox,
          backgroundColor: COLORS.mint50,
          borderLeft: `4px solid ${COLORS.mint600}`,
          borderRadius: '0 8px 8px 0',
          padding: '16px 20px',
          margin: '18px 0',
        }}>
          <Text style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize:   '13px',
            fontWeight: '700',
            color:      COLORS.mint600,
            margin:     '0 0 8px',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
          }}>
            Vous disposez d'un avoir
          </Text>
          <Text style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize:   '15px',
            fontWeight: '600',
            color:      COLORS.sage800,
            margin:     '0 0 8px',
          }}>
            Montant : {formatPrice(creditAmount)}
          </Text>
          <Text style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize:   '14px',
            color:      COLORS.sage800,
            margin:     '0',
            lineHeight: '1.7',
          }}>
            Cet avoir est rattaché à votre compte et{' '}
            <strong>valide en permanence</strong>. Pour l'utiliser lors d'un
            prochain rendez-vous, contactez Oriane qui se chargera de
            l'appliquer sur votre nouvelle séance.
          </Text>
        </Section>
      )}

      {/* Message personnalisé */}
      {therapistNote && (
        <Section style={{
          ...S.summaryBox,
          backgroundColor: COLORS.white,
          borderLeft: `4px solid ${COLORS.sage600}`,
          borderRadius: '0 8px 8px 0',
          padding: '16px 20px',
          margin: '18px 0',
        }}>
          <Text style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize:   '13px',
            fontWeight: '600',
            color:      COLORS.sage600,
            margin:     '0 0 8px',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
          }}>
            Message d'Oriane
          </Text>
          <Text style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize:   '14px',
            color:      COLORS.sage800,
            margin:     '0',
            lineHeight: '1.7',
            fontStyle:  'italic',
          }}>
            "{therapistNote}"
          </Text>
        </Section>
      )}

      <SectionDivider />

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '20px' }}>
        Cordialement,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
