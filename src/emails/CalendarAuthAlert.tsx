/**
 * Template — CalendarAuthAlert
 * Destinataire : Admin (alerte interne)
 * Sujet : "⚠️ Google Calendar — re-autorisation requise"
 */

import { Button, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { COLORS, S, SectionDivider } from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** URL vers /api/admin/google-oauth pour déclencher le flux OAuth */
  reauthorizeUrl: string;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function CalendarAuthAlert({ reauthorizeUrl }: Props) {
  return (
    <BaseLayout preview="⚠️ Google Calendar déconnecté — action requise">

      {/* Badge d'alerte */}
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
          color:         '#b45309',
          margin:        '0',
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
        }}>
          ⚠️ Action requise
        </Text>
      </Section>

      {/* Titre */}
      <Text style={S.title}>Google Calendar déconnecté</Text>

      {/* Corps */}
      <Text style={S.body}>
        Le token OAuth de Google Calendar a expiré ou a été révoqué
        (<strong>invalid_grant</strong>). La synchronisation des rendez-vous
        avec Google Agenda est actuellement <strong>interrompue</strong>.
      </Text>

      <Text style={S.body}>
        Pour rétablir la connexion, cliquez sur le bouton ci-dessous afin de
        ré-autoriser l'accès à Google Calendar. Vous serez redirigé vers la
        page de consentement Google, puis automatiquement reconnecté.
      </Text>

      {/* CTA principal */}
      <Section style={S.btnWrapper}>
        <Button href={reauthorizeUrl} style={S.btnPrimary}>
          🔗 Ré-autoriser Google Calendar
        </Button>
      </Section>

      <Text style={{ ...S.small, textAlign: 'center' as const }}>
        Lien direct :{' '}
        <Link href={reauthorizeUrl} style={{ color: COLORS.mint600, fontSize: '13px' }}>
          {reauthorizeUrl}
        </Link>
      </Text>

      <SectionDivider />

      {/* Note technique */}
      <Section style={S.infoBox}>
        <Text style={S.infoText}>
          <strong>Pourquoi ce message ?</strong> Google révoque périodiquement
          les tokens d'accès longue durée (refresh tokens) si le consentement
          n'est pas renouvelé, ou suite à un changement de mot de passe.
          Une nouvelle autorisation génère un nouveau refresh token valide.
        </Text>
      </Section>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '20px' }}>
        Notification automatique — OMF Thérapie
      </Text>

    </BaseLayout>
  );
}
