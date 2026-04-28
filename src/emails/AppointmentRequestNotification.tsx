/**
 * Template 2 — AppointmentRequestNotification
 * Destinataire : Thérapeute
 * Sujet : "Nouvelle demande de rendez-vous — [PatientName]"
 */

import { Button, Hr, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { getModeLabel, getTypeLabel } from '../lib/pricing';
import {
  RecapRow,
  S,
  SectionDivider,
  formatDateFR,
  formatPrice,
  COLORS,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  patientPostalCode: string;
  patientCity: string;
  patientReason: string;
  appointmentType: 'individual' | 'couple' | 'family';
  appointmentMode: 'in-person' | 'video';
  scheduledAt: string;
  duration: 60 | 90;
  finalPrice: number; // centimes
  isFirstSession: boolean;
  dashboardUrl: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentRequestNotification({
  patientName,
  patientEmail,
  patientPhone,
  patientPostalCode,
  patientCity,
  patientReason,
  appointmentType,
  appointmentMode,
  scheduledAt,
  duration,
  finalPrice,
  isFirstSession,
  dashboardUrl,
}: Props) {
  return (
    <BaseLayout preview={`Nouvelle demande de RDV — ${patientName}`}>

      {/* Badge + Titre */}
      <Section style={{
        backgroundColor: COLORS.accent,
        borderRadius: '6px',
        padding: '8px 16px',
        display: 'inline-block',
        margin: '0 0 16px',
      }}>
        <Text style={{
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '12px',
          fontWeight: '700',
          color: COLORS.white,
          margin: '0',
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
        }}>
          Nouvelle demande
        </Text>
      </Section>

      <Text style={S.title}>Demande de rendez-vous reçue</Text>

      <Text style={S.body}>
        Une nouvelle demande de rendez-vous vient d'être soumise sur votre
        site. Voici le récapitulatif complet.
      </Text>

      {/* Infos patient */}
      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Informations patient</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Nom"           value={patientName} />
        <RecapRow label="Email"         value={patientEmail} />
        <RecapRow label="Téléphone"     value={patientPhone} />
        <RecapRow label="Code postal"   value={patientPostalCode} />
        <RecapRow label="Ville"         value={patientCity} />
        {isFirstSession && (
          <RecapRow label="Première séance" value="Oui — tarif réduit appliqué" />
        )}
      </Section>

      {/* Détails du rendez-vous */}
      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Détails de la séance demandée</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Type"          value={getTypeLabel(appointmentType)} />
        <RecapRow label="Mode"          value={getModeLabel(appointmentMode)} />
        <RecapRow label="Date et heure" value={formatDateFR(scheduledAt)} />
        <RecapRow label="Durée"         value={`${duration} minutes`} />
        <RecapRow label="Tarif"         value={formatPrice(finalPrice)} />
      </Section>

      {/* Motif de consultation */}
      <Text style={S.subtitle}>Motif de consultation</Text>
      <Section style={{
        ...S.summaryBox,
        backgroundColor: COLORS.white,
        borderLeft: `4px solid ${COLORS.accent}`,
        borderRadius: '0 8px 8px 0',
        padding: '16px 20px',
      }}>
        <Text style={{
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '14px',
          color: COLORS.sage800,
          margin: '0',
          lineHeight: '1.7',
          fontStyle: 'italic',
        }}>
          "{patientReason}"
        </Text>
      </Section>

      <SectionDivider />

      {/* Encadré action */}
      <Section style={S.infoBox}>
        <Text style={{ ...S.infoText, fontWeight: '600', marginBottom: '6px' }}>
          📋 Pour traiter cette demande
        </Text>
        <Text style={S.infoText}>
          Connectez-vous à votre tableau de bord pour confirmer, décliner ou
          proposer un autre créneau à ce patient.
        </Text>
      </Section>

      {/* CTA */}
      <Section style={S.btnWrapper}>
        <Button href={dashboardUrl} style={S.btnPrimary}>
          Accéder au tableau de bord
        </Button>
      </Section>

      <Text style={{ ...S.small, textAlign: 'center' as const }}>
        Répondez dans les 24–48h pour offrir la meilleure expérience à vos patients.
      </Text>

    </BaseLayout>
  );
}
