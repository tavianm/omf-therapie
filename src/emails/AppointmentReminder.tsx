/**
 * Template 8 — AppointmentReminder
 * Destinataire : Patient (rappel J-1)
 * Sujet : "Rappel : votre rendez-vous demain"
 */

import { Button, Hr, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { getModeLabel } from '../lib/pricing';
import {
  COLORS,
  S,
  SectionDivider,
  formatDateFR,
  formatTimeFR,
} from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  appointmentMode: 'in-person' | 'video';
  scheduledAt: string;
  duration: 60 | 90;
  videoLink?: string;
  cabinetAddress?: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentReminder({
  patientName,
  appointmentMode,
  scheduledAt,
  duration,
  videoLink,
  cabinetAddress,
}: Props) {
  return (
    <BaseLayout preview={`Rappel : votre rendez-vous demain à ${formatTimeFR(scheduledAt)}`}>

      {/* Badge "Rappel" */}
      <Section style={{
        backgroundColor: COLORS.mint100,
        border:          `1px solid ${COLORS.border}`,
        borderRadius:    '20px',
        padding:         '5px 16px',
        display:         'inline-block',
        margin:          '0 0 16px',
      }}>
        <Text style={{
          fontFamily:    'Inter, Arial, sans-serif',
          fontSize:      '12px',
          fontWeight:    '600',
          color:         COLORS.mint600,
          margin:        '0',
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
        }}>
          📅 Rappel — demain
        </Text>
      </Section>

      {/* Titre */}
      <Text style={S.title}>Votre rendez-vous est demain</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Nous vous rappelons que vous avez un rendez-vous demain avec Oriane
        Montabonnet. Voici un récapitulatif pour préparer votre séance.
      </Text>

      {/* Heure en évidence */}
      <Section style={{
        ...S.summaryBox,
        textAlign: 'center' as const,
        padding:   '28px 24px',
        margin:    '20px 0',
      }}>
        <Text style={{ ...S.label, textAlign: 'center' as const, marginBottom: '8px' }}>
          Heure de votre séance
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
          {formatDateFR(scheduledAt)} · {duration} minutes · {getModeLabel(appointmentMode)}
        </Text>
      </Section>

      {/* Infos vidéo */}
      {appointmentMode === 'video' && videoLink && (
        <>
          <Text style={S.subtitle}>Accès à votre séance en ligne</Text>
          <Text style={{ ...S.body, color: COLORS.sage600, fontSize: '14px' }}>
            Quelques minutes avant l'heure, cliquez sur le bouton ci-dessous
            pour rejoindre votre consultation. Assurez-vous d'être dans un
            endroit calme et d'avoir une connexion internet stable.
          </Text>
          <Section style={S.btnWrapper}>
            <Button href={videoLink} style={S.btnPrimary}>
              🎥 Rejoindre la séance
            </Button>
          </Section>
          <Text style={{ ...S.small, textAlign: 'center' as const }}>
            Lien direct :{' '}
            <Link href={videoLink} style={{ color: COLORS.mint600, fontSize: '13px' }}>
              {videoLink}
            </Link>
          </Text>
        </>
      )}

      {/* Infos présentiel */}
      {appointmentMode === 'in-person' && (
        <Section style={S.infoBox}>
          <Text style={{ ...S.infoText, fontWeight: '600', marginBottom: '6px' }}>
            📍 Adresse du cabinet
          </Text>
          <Text style={S.infoText}>
            {cabinetAddress ?? '1086 Av. Albert Einstein, 34000 Montpellier'}
          </Text>
          <Text style={{ ...S.infoText, marginTop: '8px' }}>
            Pensez à prévoir quelques minutes de trajet supplémentaires pour
            arriver sereinement.
          </Text>
        </Section>
      )}

      <SectionDivider />

      {/* Annulation */}
      <Section style={S.warnBox}>
        <Text style={{ ...S.infoText, color: COLORS.sage800 }}>
          ⚠️ <strong>Vous ne pouvez pas venir ?</strong> Merci de nous prévenir
          le plus tôt possible, idéalement avant ce soir, en nous appelant au{' '}
          <Link href="tel:+33650331853" style={{ color: COLORS.mint600 }}>
            06 50 33 18 53
          </Link>{' '}
          ou en nous écrivant à{' '}
          <Link href="mailto:contact@omf-therapie.fr" style={{ color: COLORS.mint600 }}>
            contact@omf-therapie.fr
          </Link>
          .
        </Text>
      </Section>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '20px' }}>
        À demain,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
