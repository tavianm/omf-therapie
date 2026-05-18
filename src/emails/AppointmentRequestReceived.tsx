/**
 * Template 1 — AppointmentRequestReceived
 * Destinataire : Patient
 * Sujet : "Votre demande de rendez-vous a bien été reçue"
 */

import { Button, Hr, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { getModeLabel, getTypeLabel } from '../lib/pricing';
import {
  COLORS,
  RecapRow,
  S,
  SectionDivider,
  formatDateFR,
  formatPrice,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  appointmentType: 'individual' | 'couple' | 'family';
  appointmentMode: 'in-person' | 'video';
  scheduledAt: string; // ISO string
  duration: 60 | 90;
  finalPrice: number; // centimes
  isFirstSession: boolean;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentRequestReceived({
  patientName,
  appointmentType,
  appointmentMode,
  scheduledAt,
  duration,
  finalPrice,
  isFirstSession,
}: Props) {
  return (
    <BaseLayout preview="Votre demande de rendez-vous a bien été reçue — OMF Thérapie">

      {/* Titre */}
      <Text style={S.title}>Votre demande a été reçue ✓</Text>

      {/* Salutation */}
      <Text style={S.body}>
        Bonjour {patientName},
      </Text>

      <Text style={S.body}>
        Nous avons bien reçu votre demande de rendez-vous. Oriane Montabonnet
        examinera votre demande et vous répondra dans les{' '}
        <strong>24 à 48 heures</strong>.
      </Text>

      {/* Récapitulatif */}
      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Récapitulatif de votre demande</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Type de séance" value={getTypeLabel(appointmentType)} />
        <RecapRow label="Mode"           value={getModeLabel(appointmentMode)} />
        <RecapRow label="Date et heure"  value={formatDateFR(scheduledAt)} />
        <RecapRow label="Durée"          value={`${duration} minutes`} />
        <RecapRow label="Tarif estimé"   value={formatPrice(finalPrice)} />
      </Section>

      {/* Première séance */}
      {isFirstSession && (
        <Section style={S.infoBox}>
          <Text style={S.infoText}>
            💚{' '}
            <strong>Première séance :</strong> Vous avez indiqué qu'il s'agit
            de votre première consultation. Un tarif de première séance
            s'applique — il est déjà inclus dans le tarif estimé ci-dessus.
          </Text>
        </Section>
      )}

      {/* Paiement vidéo */}
      {appointmentMode === 'video' && (
        <Section style={S.infoBox}>
          <Text style={S.infoText}>
            💳{' '}
            <strong>Téléconsultation :</strong> Pour les séances en ligne, un
            prépaiement sécurisé vous sera demandé par email après confirmation
            du rendez-vous. Votre séance sera définitivement réservée à
            réception du paiement.
          </Text>
        </Section>
      )}

      <Text style={S.body}>
        En attendant la confirmation, n'hésitez pas à nous contacter si vous
        avez la moindre question.
      </Text>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic' }}>
        Bien à vous,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

      <SectionDivider />

      {/* CTA */}
      <Section style={S.btnWrapper}>
        <Button href="mailto:contact@omf-therapie.fr" style={S.btnPrimary}>
          Nous contacter
        </Button>
      </Section>

    </BaseLayout>
  );
}
