/**
 * Template — AppointmentRescheduledPaid
 * Destinataire : Patient
 * Sujet : "Votre rendez-vous a été reporté"
 *
 * Notification simple d'un report effectué par la thérapeute sur un RDV déjà
 * arrimé (confirmed ∨ payment_received, tous modes). À ne pas confondre avec
 * `AppointmentRescheduled` (proposition demandant acceptation, flow patient).
 * Ici : move direct admin, pas de bouton d'acceptation, paiement/avoir conservé.
 */

import { Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import {
  COLORS,
  S,
  SectionDivider,
  formatDateFR,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  originalScheduledAt: string;
  newScheduledAt: string;
  appointmentMode: 'in-person' | 'video';
  duration: number;
  finalPrice: number; // centimes
  therapistNote?: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentRescheduledPaid({
  patientName,
  originalScheduledAt,
  newScheduledAt,
  appointmentMode,
  duration,
  // finalPrice est conservé dans l'interface pour cohérence avec les autres
  // templates mais n'est pas affiché ici (le paiement est conservé, pas redemandé).
  finalPrice: _finalPrice,
  therapistNote,
}: Props) {
  return (
    <BaseLayout preview="Votre rendez-vous a été reporté — OMF Thérapie">

      {/* Titre */}
      <Text style={S.title}>Votre rendez-vous a été reporté</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Votre rendez-vous {appointmentMode === 'video' ? 'en téléconsultation' : 'au cabinet'}{' '}
        initialement prévu le{' '}
        <strong>{formatDateFR(originalScheduledAt)}</strong> a été reporté au{' '}
        <strong>{formatDateFR(newScheduledAt)}</strong> ({duration} min).
      </Text>

      <Text style={S.body}>
        Bonne nouvelle : votre paiement est{' '}
        <strong>conservé et reste valable</strong> pour ce nouveau créneau.
        Aucune action n'est attendue de votre part.
      </Text>

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
