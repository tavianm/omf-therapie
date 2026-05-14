/**
 * Template 4 — AppointmentDeclined
 * Destinataire : Patient
 * Sujet : "Votre demande de rendez-vous"
 */

import { Button, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import {
  COLORS,
  S,
  SectionDivider,
  formatDateOnlyFR,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  scheduledAt: string;
  therapistNote?: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentDeclined({
  patientName,
  scheduledAt,
  therapistNote,
}: Props) {
  return (
    <BaseLayout preview="Votre demande de rendez-vous — OMF Thérapie">

      {/* Titre */}
      <Text style={S.title}>Concernant votre demande de rendez-vous</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Merci de l'intérêt que vous portez à OMF Thérapie et d'avoir pris le
        temps de soumettre votre demande de rendez-vous pour le{' '}
        <strong>{formatDateOnlyFR(scheduledAt)}</strong>.
      </Text>

      <Text style={S.body}>
        Malheureusement, ce créneau n'est <strong>plus disponible</strong>.
        Nous sommes sincèrement désolés pour la gêne occasionnée.
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

      <Text style={S.body}>
        Nous vous invitons à consulter les créneaux disponibles sur notre site
        et à soumettre une nouvelle demande — nous serons ravis de vous
        accompagner.
      </Text>

      <SectionDivider />

      {/* CTA */}
      <Section style={S.btnWrapper}>
        <Button
          href="https://omf-therapie.fr/rendez-vous"
          style={S.btnPrimary}
        >
          Prendre un nouveau rendez-vous
        </Button>
      </Section>

      <Text style={{ ...S.small, textAlign: 'center' as const }}>
        Des questions ? Écrivez-nous à{' '}
        <span style={{ color: COLORS.mint600 }}>contact@omf-therapie.fr</span>
      </Text>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '20px' }}>
        Cordialement,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
