import { Button, Hr, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { getModeLabel, getTypeLabel } from '../lib/pricing';
import { RecapRow, S, formatDateFR, formatPrice, COLORS } from './_helpers';

interface Props {
  patientName: string;
  patientEmail: string;
  appointmentType: 'individual' | 'couple' | 'family';
  appointmentMode: 'in-person' | 'video';
  scheduledAt: string;
  duration: 60 | 90;
  finalPrice: number;
  videoLink?: string;
  dashboardUrl: string;
  calendarEventCreated: boolean;
}

export default function PaymentReceivedNotification({
  patientName,
  patientEmail,
  appointmentType,
  appointmentMode,
  scheduledAt,
  duration,
  finalPrice,
  videoLink,
  dashboardUrl,
  calendarEventCreated,
}: Props) {
  return (
    <BaseLayout preview={`Paiement reçu — ${patientName}`}>
      <Text style={S.title}>Paiement reçu pour un rendez-vous visio</Text>

      <Text style={S.body}>
        Le prépaiement Stripe a bien été confirmé pour ce rendez-vous.
      </Text>

      <Section style={S.summaryBox}>
        <Text style={S.summaryTitle}>Récapitulatif</Text>
        <Hr style={S.summaryDivider} />
        <RecapRow label="Patient" value={patientName} />
        <RecapRow label="Email" value={patientEmail} />
        <RecapRow label="Type" value={getTypeLabel(appointmentType)} />
        <RecapRow label="Mode" value={getModeLabel(appointmentMode)} />
        <RecapRow label="Date et heure" value={formatDateFR(scheduledAt)} />
        <RecapRow label="Durée" value={`${duration} minutes`} />
        <RecapRow label="Montant payé" value={formatPrice(finalPrice)} />
        <RecapRow
          label="Événement calendrier"
          value={calendarEventCreated ? 'Créé' : 'Échec de création (vérifier Google Calendar)'}
        />
      </Section>

      {videoLink && (
        <Section style={S.infoBox}>
          <Text style={{ ...S.infoText, fontWeight: '600', marginBottom: '6px' }}>
            Lien visio généré
          </Text>
          <Link href={videoLink} style={{ ...S.link, color: COLORS.mint600 }}>
            {videoLink}
          </Link>
        </Section>
      )}

      <Section style={S.btnWrapper}>
        <Button href={dashboardUrl} style={S.btnPrimary}>
          Ouvrir le tableau de bord
        </Button>
      </Section>
    </BaseLayout>
  );
}
