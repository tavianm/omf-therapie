/**
 * Template 3 — AppointmentConfirmed
 * Destinataire : Patient
 * Sujet : "Votre rendez-vous est confirmé — [Date]"
 */

import { Button, Hr, Link, Section, Text } from '@react-email/components';
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
  scheduledAt: string;
  duration: 60 | 90;
  finalPrice: number; // centimes
  videoLink?: string;
  googleCalendarLink: string;
  appleCalendarLink: string;
  outlookCalendarLink: string;
  cabinetAddress?: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentConfirmed({
  patientName,
  appointmentType,
  appointmentMode,
  scheduledAt,
  duration,
  finalPrice,
  videoLink,
  googleCalendarLink,
  appleCalendarLink,
  outlookCalendarLink,
  cabinetAddress,
}: Props) {
  return (
    <BaseLayout preview={`Votre rendez-vous est confirmé — ${formatDateFR(scheduledAt)}`}>

      {/* Titre */}
      <Text style={S.title}>Votre rendez-vous est confirmé 🎉</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Excellente nouvelle ! Votre rendez-vous a été confirmé. Vous trouverez
        ci-dessous tous les détails de votre séance.
      </Text>

      {/* Récapitulatif */}
      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Votre séance</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Type de séance" value={getTypeLabel(appointmentType)} />
        <RecapRow label="Mode"           value={getModeLabel(appointmentMode)} />
        <RecapRow label="Date et heure"  value={formatDateFR(scheduledAt)} />
        <RecapRow label="Durée"          value={`${duration} minutes`} />
        <RecapRow label="Tarif"          value={formatPrice(finalPrice)} />
      </Section>

      {/* Lien vidéo */}
      {appointmentMode === 'video' && videoLink && (
        <>
          <Text style={S.subtitle}>Lien de connexion à votre séance</Text>
          <Section style={{
            ...S.summaryBox,
            backgroundColor: COLORS.mint50,
            textAlign: 'center' as const,
            padding: '24px',
          }}>
            <Text style={{
              fontFamily: 'Inter, Arial, sans-serif',
              fontSize:   '13px',
              color:      COLORS.sage600,
              margin:     '0 0 14px',
            }}>
              Le jour de votre séance, cliquez sur le bouton ci-dessous pour
              rejoindre la consultation en ligne.
            </Text>
            <Button href={videoLink} style={S.btnPrimary}>
              Rejoindre la séance vidéo
            </Button>
            <Text style={{ ...S.small, marginTop: '10px' }}>
              Ou copiez ce lien :{' '}
              <Link href={videoLink} style={{ color: COLORS.mint600, fontSize: '13px' }}>
                {videoLink}
              </Link>
            </Text>
          </Section>
        </>
      )}

      {/* Adresse cabinet */}
      {appointmentMode === 'in-person' && (
        <Section style={S.infoBox}>
          <Text style={{ ...S.infoText, marginBottom: '4px' }}>
            📍 <strong>Adresse du cabinet</strong>
          </Text>
          <Text style={S.infoText}>
            {cabinetAddress ?? '1086 Av. Albert Einstein, 34000 Montpellier'}
          </Text>
        </Section>
      )}

      <SectionDivider />

      {/* Calendrier */}
      <Text style={S.subtitle}>Ajouter à votre calendrier</Text>

      <Text style={{ ...S.body, color: COLORS.sage600, fontSize: '14px' }}>
        Pour ne pas oublier votre rendez-vous, ajoutez-le directement à votre
        calendrier en un clic.
      </Text>

      <Section style={{ textAlign: 'center' as const, margin: '16px 0 10px' }}>
        <Button href={googleCalendarLink} style={S.btnSage}>
          📅 Ajouter à Google Calendar
        </Button>
      </Section>

      <Section style={{ textAlign: 'center' as const, margin: '8px 0 10px' }}>
        <Button href={appleCalendarLink} style={S.btnOutline}>
           Ajouter à Apple Calendar
        </Button>
      </Section>

      <Section style={{ textAlign: 'center' as const, margin: '8px 0 24px' }}>
        <Button href={outlookCalendarLink} style={S.btnOutline}>
          🪟 Ajouter à Outlook
        </Button>
      </Section>

      <SectionDivider />

      {/* Rappel annulation */}
      <Section style={S.warnBox}>
        <Text style={{ ...S.infoText, color: COLORS.sage800 }}>
          ⏰ <strong>Annulation ou report :</strong> si vous ne pouvez pas
          honorer ce rendez-vous, merci de nous en informer au moins{' '}
          <strong>48 heures à l'avance</strong> par email à{' '}
          <Link href="mailto:contact@omf-therapie.fr" style={{ color: COLORS.mint600 }}>
            contact@omf-therapie.fr
          </Link>{' '}
          ou par téléphone au{' '}
          <Link href="tel:+33650331853" style={{ color: COLORS.mint600 }}>
            06 50 33 18 53
          </Link>
          .
        </Text>
      </Section>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '20px' }}>
        Au plaisir de vous accueillir,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
