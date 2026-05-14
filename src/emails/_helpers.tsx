/**
 * Helpers partagés pour les templates React Email OMF Thérapie.
 * Couleurs, formatage, styles communs et composants réutilisables.
 */

import type { CSSProperties } from 'react';
import { Hr, Text } from '@react-email/components';

// ---------------------------------------------------------------------------
// Palette (miroir de tailwind.config.js + BaseLayout)
// ---------------------------------------------------------------------------

export const COLORS = {
  sage800: '#364436',
  sage600: '#4e674e',
  mint600: '#477a6d',
  mint50:  '#f2f8f6',
  mint100: '#dff0ea',
  accent:  '#d4a96a',
  white:   '#ffffff',
  border:  '#cfdccf',
} as const;

// ---------------------------------------------------------------------------
// Formatage des dates
// ---------------------------------------------------------------------------

/**
 * Formate une date ISO en français complet avec heure.
 * Ex: "Lundi 14 juillet 2025 à 10h00"
 */
export function formatDateFR(isoString: string): string {
  const date = new Date(isoString);
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
    hour:    '2-digit',
    minute:  '2-digit',
    timeZone: 'Europe/Paris',
  }).format(date);
  // Capitalise la première lettre (fr-FR retourne en minuscules)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Formate une date ISO en français — date seule (sans heure).
 * Ex: "Lundi 14 juillet 2025"
 */
export function formatDateOnlyFR(isoString: string): string {
  const date = new Date(isoString);
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
    timeZone: 'Europe/Paris',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Formate une date ISO — heure seule.
 * Ex: "10h00"
 */
export function formatTimeFR(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(isoString));
}

// ---------------------------------------------------------------------------
// Formatage des prix
// ---------------------------------------------------------------------------

/**
 * Convertit un montant en centimes vers un string lisible.
 * Ex: 5000 → "50€" | 5050 → "50.50€"
 */
export function formatPrice(centimes: number): string {
  const euros = centimes / 100;
  return Number.isInteger(euros) ? `${euros}€` : `${euros.toFixed(2)}€`;
}

// ---------------------------------------------------------------------------
// Styles partagés
// ---------------------------------------------------------------------------

export const S = {
  // ── Typographie ───────────────────────────────────────────────────────────

  title: {
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    fontSize:   '26px',
    fontWeight: '600',
    color:      COLORS.sage800,
    margin:     '0 0 20px',
    lineHeight: '1.3',
  } as CSSProperties,

  subtitle: {
    fontFamily:  '"Cormorant Garamond", Georgia, serif',
    fontSize:    '18px',
    fontWeight:  '600',
    color:       COLORS.sage800,
    margin:      '0 0 12px',
    lineHeight:  '1.4',
  } as CSSProperties,

  body: {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize:   '15px',
    color:      COLORS.sage800,
    lineHeight: '1.7',
    margin:     '0 0 14px',
  } as CSSProperties,

  small: {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize:   '13px',
    color:      COLORS.sage600,
    lineHeight: '1.6',
    margin:     '6px 0 0',
  } as CSSProperties,

  label: {
    fontFamily:    'Inter, Arial, sans-serif',
    fontSize:      '11px',
    fontWeight:    '600',
    color:         COLORS.sage600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase' as const,
    margin:        '0 0 4px',
  } as CSSProperties,

  // ── Encadrés ──────────────────────────────────────────────────────────────

  summaryBox: {
    backgroundColor: COLORS.mint50,
    border:          `1px solid ${COLORS.border}`,
    borderRadius:    '8px',
    padding:         '20px 24px',
    margin:          '20px 0',
  } as CSSProperties,

  summaryTitle: {
    fontFamily:    '"Cormorant Garamond", Georgia, serif',
    fontSize:      '14px',
    fontWeight:    '600',
    color:         COLORS.sage600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    margin:        '0 0 12px',
  } as CSSProperties,

  infoBox: {
    backgroundColor: COLORS.mint100,
    border:          `1px solid ${COLORS.border}`,
    borderRadius:    '8px',
    padding:         '14px 18px',
    margin:          '14px 0',
  } as CSSProperties,

  infoText: {
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize:   '14px',
    color:      COLORS.sage600,
    margin:     '0',
    lineHeight: '1.6',
  } as CSSProperties,

  warnBox: {
    backgroundColor: '#fff8ee',
    border:          `1px solid ${COLORS.accent}`,
    borderRadius:    '8px',
    padding:         '14px 18px',
    margin:          '14px 0',
  } as CSSProperties,

  // ── Boutons ───────────────────────────────────────────────────────────────

  btnPrimary: {
    backgroundColor: COLORS.accent,
    borderRadius:    '6px',
    color:           COLORS.white,
    fontFamily:      'Inter, Arial, sans-serif',
    fontSize:        '15px',
    fontWeight:      '600',
    padding:         '13px 32px',
    textDecoration:  'none',
    display:         'inline-block',
    textAlign:       'center' as const,
    cursor:          'pointer',
  } as CSSProperties,

  btnSage: {
    backgroundColor: COLORS.sage800,
    borderRadius:    '6px',
    color:           COLORS.white,
    fontFamily:      'Inter, Arial, sans-serif',
    fontSize:        '15px',
    fontWeight:      '600',
    padding:         '13px 32px',
    textDecoration:  'none',
    display:         'inline-block',
    textAlign:       'center' as const,
    cursor:          'pointer',
  } as CSSProperties,

  btnOutline: {
    backgroundColor: 'transparent',
    border:          `2px solid ${COLORS.sage800}`,
    borderRadius:    '6px',
    color:           COLORS.sage800,
    fontFamily:      'Inter, Arial, sans-serif',
    fontSize:        '14px',
    fontWeight:      '600',
    padding:         '11px 28px',
    textDecoration:  'none',
    display:         'inline-block',
    textAlign:       'center' as const,
    cursor:          'pointer',
  } as CSSProperties,

  btnWrapper: {
    textAlign: 'center' as const,
    margin:    '24px 0',
  } as CSSProperties,

  // ── Divers ────────────────────────────────────────────────────────────────

  divider: {
    borderColor: COLORS.border,
    margin:      '24px 0',
  } as CSSProperties,

  summaryDivider: {
    borderColor: COLORS.border,
    margin:      '0 0 12px',
  } as CSSProperties,

  highlight: {
    fontFamily:      'Inter, Arial, sans-serif',
    fontSize:        '22px',
    fontWeight:      '700',
    color:           COLORS.sage800,
    textAlign:       'center' as const,
    margin:          '8px 0',
    letterSpacing:   '-0.01em',
  } as CSSProperties,

  link: {
    color:          COLORS.mint600,
    textDecoration: 'underline',
    fontSize:       '14px',
  } as CSSProperties,
} as const;

// ---------------------------------------------------------------------------
// Composants partagés
// ---------------------------------------------------------------------------

/**
 * Ligne de récapitulatif : "Label : valeur"
 */
export function RecapRow({ label, value }: { label: string; value: string }) {
  return (
    <Text style={{ fontFamily: 'Inter, Arial, sans-serif', fontSize: '14px', color: COLORS.sage800, margin: '5px 0', lineHeight: '1.6' }}>
      <strong style={{ color: COLORS.sage600 }}>{label} :</strong>{' '}{value}
    </Text>
  );
}

/**
 * Séparateur de section avec espacement
 */
export function SectionDivider() {
  return <Hr style={S.divider} />;
}
