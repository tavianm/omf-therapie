/**
 * BaseLayout — Layout React Email de base pour tous les emails OMF Thérapie
 *
 * Packages requis (à ajouter aux dépendances) :
 *   "@react-email/components": "^0.0.x"
 *   "react": "^18.x"          (déjà présent)
 *
 * Usage :
 *   import { BaseLayout } from '@/emails/BaseLayout';
 *   <BaseLayout preview="Votre rendez-vous est confirmé">…</BaseLayout>
 */

import {
  Body,
  Container,
  Font,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Palette (valeurs exactes du tailwind.config.js)
// ---------------------------------------------------------------------------

const COLORS = {
  sage800: '#364436',
  sage600: '#4e674e',
  mint600:  '#477a6d',
  mint50:   '#f2f8f6',
  white:    '#ffffff',
  border:   '#cfdccf', // sage-200
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseLayoutProps {
  /** Texte de prévisualisation affiché dans la liste des emails (snippet). */
  preview?: string;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Styles inline (React Email ne supporte pas les classes CSS)
// ---------------------------------------------------------------------------

const styles = {
  html: {
    backgroundColor: COLORS.white,
    fontFamily: 'Inter, Arial, sans-serif',
  },
  body: {
    backgroundColor: COLORS.white,
    margin: '0',
    padding: '0',
  },
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    backgroundColor: COLORS.white,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    backgroundColor: COLORS.mint50,
    padding: '32px 40px 24px',
    borderBottom: `2px solid ${COLORS.border}`,
    textAlign: 'center' as const,
  },
  headerTitle: {
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    fontSize: '30px',
    fontWeight: '600',
    color: COLORS.sage800,
    margin: '0 0 4px',
    letterSpacing: '0.01em',
    lineHeight: '1.2',
  },
  headerSubtitle: {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: '13px',
    color: COLORS.sage600,
    margin: '0',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },

  // ── Contenu ──────────────────────────────────────────────────────────────
  content: {
    padding: '32px 40px',
  },

  // ── Footer ──────────────────────────────────────────────────────────────
  footerWrapper: {
    padding: '0 40px 32px',
  },
  footerDivider: {
    borderColor: COLORS.border,
    margin: '0 0 24px',
  },
  footerMention: {
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    fontSize: '13px',
    color: COLORS.sage600,
    textAlign: 'center' as const,
    margin: '0 0 12px',
    fontStyle: 'italic',
  },
  footerAddress: {
    fontSize: '12px',
    color: COLORS.sage600,
    textAlign: 'center' as const,
    margin: '0 0 4px',
    lineHeight: '1.6',
  },
  footerLink: {
    color: COLORS.mint600,
    textDecoration: 'none',
    fontSize: '12px',
  },
  footerLegal: {
    fontSize: '11px',
    color: COLORS.sage600,
    textAlign: 'center' as const,
    margin: '16px 0 0',
    opacity: 0.7,
  },
} as const;

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

export function BaseLayout({ preview, children }: BaseLayoutProps) {
  return (
    <Html lang="fr" dir="ltr" style={styles.html}>
      <Head>
        {/* Inter — Google Fonts */}
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Arial"
          webFont={{
            url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2',
            format: 'woff2',
          }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Arial"
          webFont={{
            url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI6fAZ9hiJ-Ek-_EeA.woff2',
            format: 'woff2',
          }}
          fontWeight={600}
          fontStyle="normal"
        />
        {/* Cormorant Garamond — Google Fonts */}
        <Font
          fontFamily="Cormorant Garamond"
          fallbackFontFamily="Georgia"
          webFont={{
            url: 'https://fonts.gstatic.com/s/cormorantgaramond/v16/co3YmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2',
            format: 'woff2',
          }}
          fontWeight={600}
          fontStyle="normal"
        />
      </Head>

      {preview && <Preview>{preview}</Preview>}

      <Body style={styles.body}>
        <Container style={styles.container}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <Section style={styles.header}>
            <Text style={styles.headerTitle}>OMF Thérapie</Text>
            <Text style={styles.headerSubtitle}>
              Oriane Montabonnet · Psychopraticienne
            </Text>
          </Section>

          {/* ── Contenu principal ──────────────────────────────────────── */}
          <Section style={styles.content}>
            {children}
          </Section>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <Section style={styles.footerWrapper}>
            <Hr style={styles.footerDivider} />

            <Text style={styles.footerMention}>
              Thérapie individuelle, de couple et familiale
            </Text>

            <Text style={styles.footerAddress}>
              1086 Av. Albert Einstein, 34000 Montpellier
            </Text>

            <Text style={styles.footerAddress}>
              <Link
                href="mailto:contact@omf-therapie.fr"
                style={styles.footerLink}
              >
                contact@omf-therapie.fr
              </Link>
              {'  ·  '}
              <Link href="tel:+33650331853" style={styles.footerLink}>
                06 50 33 18 53
              </Link>
            </Text>

            <Text style={styles.footerLegal}>
              Vous recevez cet email car vous avez utilisé le formulaire de
              contact ou de prise de rendez-vous sur{' '}
              <Link
                href="https://omf-therapie.fr"
                style={{ ...styles.footerLink, fontSize: '11px' }}
              >
                omf-therapie.fr
              </Link>
              .
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}
