/**
 * Template 7 — ReviewRequest
 * Destinataire : Patient (demande d'avis)
 * Sujet : "Votre avis compte pour nous"
 */

import { Button, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { COLORS, S, SectionDivider } from './_helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  patientName: string;
  therapistNote?: string;
  googleBusinessUrl?: string;
  pagesJaunesUrl?: string;
  psychologueNetUrl?: string;
}

// ---------------------------------------------------------------------------
// Styles locaux
// ---------------------------------------------------------------------------

const reviewBtnStyle = {
  display:        'inline-block',
  borderRadius:   '6px',
  fontFamily:     'Inter, Arial, sans-serif',
  fontSize:       '14px',
  fontWeight:     '600' as const,
  padding:        '11px 24px',
  textDecoration: 'none',
  cursor:         'pointer',
  textAlign:      'center' as const,
  margin:         '6px',
} as const;

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export default function ReviewRequest({
  patientName,
  therapistNote,
  googleBusinessUrl,
  pagesJaunesUrl,
  psychologueNetUrl,
}: Props) {
  const hasAnyReviewUrl = googleBusinessUrl || pagesJaunesUrl || psychologueNetUrl;

  return (
    <BaseLayout preview="Votre avis compte pour nous — OMF Thérapie">

      {/* Titre */}
      <Text style={S.title}>Votre avis nous tient à cœur 🌿</Text>

      {/* Salutation */}
      <Text style={S.body}>Bonjour {patientName},</Text>

      {/* Message personnalisé ou message par défaut */}
      {therapistNote ? (
        <>
          <Section style={{
            ...S.summaryBox,
            backgroundColor: COLORS.white,
            borderLeft: `4px solid ${COLORS.accent}`,
            borderRadius: '0 8px 8px 0',
            padding: '16px 20px',
            margin: '0 0 20px',
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
              Un mot d'Oriane
            </Text>
            <Text style={{
              fontFamily: 'Inter, Arial, sans-serif',
              fontSize:   '15px',
              color:      COLORS.sage800,
              margin:     '0',
              lineHeight: '1.7',
              fontStyle:  'italic',
            }}>
              "{therapistNote}"
            </Text>
          </Section>
          <Text style={S.body}>
            Si votre expérience a été positive, je serais très touchée de
            pouvoir lire vos mots. Un avis, même court, aide d'autres personnes
            à trouver l'accompagnement dont elles ont besoin.
          </Text>
        </>
      ) : (
        <>
          <Text style={S.body}>
            J'espère sincèrement que notre travail ensemble vous a apporté ce
            que vous recherchiez. Votre parcours et votre engagement dans cette
            démarche thérapeutique méritent d'être salués.
          </Text>
          <Text style={S.body}>
            Si vous le souhaitez, et uniquement si vous vous en sentez l'envie,
            votre témoignage — aussi court soit-il — peut aider d'autres
            personnes à franchir le pas et à trouver l'accompagnement dont
            elles ont besoin.
          </Text>
        </>
      )}

      {/* Boutons d'avis */}
      {hasAnyReviewUrl && (
        <>
          <SectionDivider />

          <Text style={{ ...S.subtitle, textAlign: 'center' as const }}>
            Laisser un avis
          </Text>

          <Section style={{ textAlign: 'center' as const, margin: '8px 0 16px' }}>

            {googleBusinessUrl && (
              <Button
                href={googleBusinessUrl}
                style={{
                  ...reviewBtnStyle,
                  backgroundColor: '#4285F4',
                  color:           COLORS.white,
                }}
              >
                ⭐ Avis Google
              </Button>
            )}

            {pagesJaunesUrl && (
              <Button
                href={pagesJaunesUrl}
                style={{
                  ...reviewBtnStyle,
                  backgroundColor: '#FFCC00',
                  color:           '#333',
                }}
              >
                📒 Avis Pages Jaunes
              </Button>
            )}

            {psychologueNetUrl && (
              <Button
                href={psychologueNetUrl}
                style={{
                  ...reviewBtnStyle,
                  backgroundColor: COLORS.sage800,
                  color:           COLORS.white,
                }}
              >
                🧠 Avis Psychologue.net
              </Button>
            )}

          </Section>
        </>
      )}

      <SectionDivider />

      {/* Message de fin */}
      <Section style={{
        ...S.infoBox,
        textAlign: 'center' as const,
      }}>
        <Text style={{
          fontFamily: '"Cormorant Garamond", Georgia, serif',
          fontSize:   '17px',
          color:      COLORS.sage800,
          fontStyle:  'italic',
          margin:     '0',
          lineHeight: '1.6',
        }}>
          "Merci pour votre confiance. C'est un honneur de vous avoir accompagné
          dans cette démarche."
        </Text>
      </Section>

      <Text style={{ ...S.body, color: COLORS.sage600, fontStyle: 'italic', marginTop: '20px' }}>
        Avec toute ma gratitude,
        <br />
        Oriane Montabonnet — OMF Thérapie
      </Text>

      <Text style={{ ...S.small, marginTop: '16px', color: COLORS.sage600 }}>
        Aucune obligation de votre part — déposez un avis uniquement si vous
        en avez l'envie sincère. Votre vie privée est entièrement respectée.
      </Text>

    </BaseLayout>
  );
}
