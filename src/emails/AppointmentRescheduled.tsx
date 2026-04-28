/**
 * Template 5 — AppointmentRescheduled
 * Destinataire : Patient
 * Sujet : "Proposition de nouveau créneau"
 */

import { Button, Hr, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { getModeLabel } from '../lib/pricing';
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
  originalScheduledAt: string;
  newScheduledAt: string;
  appointmentMode: 'in-person' | 'video';
  duration: 60 | 90;
  finalPrice: number; // centimes
  therapistNote?: string;
  bookingUrl: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function AppointmentRescheduled({
  patientName,
  originalScheduledAt,
  newScheduledAt,
  appointmentMode,
  duration,
  finalPrice,
  therapistNote,
  bookingUrl,
}: Props) {
  return (
    <BaseLayout preview="Proposition de nouveau créneau — OMF Thérapie">

      {/* Titre */}
      <Text style={S.title}>Proposition de nouveau créneau 📅</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      <Text style={S.body}>
        Nous revenons vers vous concernant votre demande de rendez-vous. Le
        créneau que vous aviez sélectionné n'est malheureusement plus
        disponible, mais nous avons le plaisir de vous proposer une alternative.
      </Text>

      {/* Comparaison créneaux */}
      <Section style={{ margin: '20px 0' }}>

        {/* Ancien créneau */}
        <Section style={{
          backgroundColor: '#fff5f5',
          border:         '1px solid #f5c6c6',
          borderRadius:   '8px',
          padding:        '16px 20px',
          marginBottom:   '8px',
        }}>
          <Text style={{
            fontFamily:    'Inter, Arial, sans-serif',
            fontSize:      '11px',
            fontWeight:    '700',
            color:         '#c0392b',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
            margin:        '0 0 6px',
          }}>
            ✕ Créneau initial (indisponible)
          </Text>
          <Text style={{
            fontFamily:    'Inter, Arial, sans-serif',
            fontSize:      '15px',
            color:         '#999',
            margin:        '0',
            textDecoration: 'line-through',
          }}>
            {formatDateFR(originalScheduledAt)}
          </Text>
        </Section>

        {/* Flèche */}
        <Text style={{ textAlign: 'center' as const, fontSize: '20px', margin: '6px 0', color: COLORS.sage600 }}>
          ↓
        </Text>

        {/* Nouveau créneau */}
        <Section style={{
          backgroundColor: COLORS.mint50,
          border:          `2px solid ${COLORS.accent}`,
          borderRadius:    '8px',
          padding:         '16px 20px',
        }}>
          <Text style={{
            fontFamily:    'Inter, Arial, sans-serif',
            fontSize:      '11px',
            fontWeight:    '700',
            color:         COLORS.accent,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.08em',
            margin:        '0 0 6px',
          }}>
            ✓ Nouveau créneau proposé
          </Text>
          <Text style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize:   '16px',
            fontWeight: '600',
            color:      COLORS.sage800,
            margin:     '0',
          }}>
            {formatDateFR(newScheduledAt)}
          </Text>
        </Section>

      </Section>

      {/* Détails */}
      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Détails de la séance</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Mode"   value={getModeLabel(appointmentMode)} />
        <RecapRow label="Durée"  value={`${duration} minutes`} />
        <RecapRow label="Tarif"  value={formatPrice(finalPrice)} />
      </Section>

      {/* Message personnalisé */}
      {therapistNote && (
        <Section style={{
          ...S.summaryBox,
          backgroundColor: COLORS.white,
          borderLeft: `4px solid ${COLORS.sage600}`,
          borderRadius: '0 8px 8px 0',
          padding: '16px 20px',
        }}>
          <Text style={{
            fontFamily:    'Inter, Arial, sans-serif',
            fontSize:      '13px',
            fontWeight:    '600',
            color:         COLORS.sage600,
            margin:        '0 0 8px',
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

      {/* CTA principal */}
      <Section style={S.btnWrapper}>
        <Button href={bookingUrl} style={S.btnPrimary}>
          Accepter ce nouveau créneau
        </Button>
      </Section>

      {/* Lien alternatif */}
      <Text style={{ ...S.small, textAlign: 'center' as const }}>
        Ce créneau ne vous convient pas ?{' '}
        <Link
          href="https://omf-therapie.fr/rendez-vous"
          style={{ color: COLORS.mint600, fontSize: '13px' }}
        >
          Choisir un autre créneau sur notre site
        </Link>
      </Text>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '24px' }}>
        Cordialement,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
