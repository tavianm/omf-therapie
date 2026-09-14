/**
 * Shared UI atoms for the workbench (proposal B) — visual language taken from
 * the Figma file "Refonte admin": soft status chips, forest-green time blocks,
 * serif headings, 44px touch targets. Proposal B uses its own status labels
 * ("Réglé" instead of "Paiement reçu") per the mockups.
 */

import { useEffect, useRef } from 'react';
import type { Appointment, AppointmentStatus } from '../../../types/appointment';
import { getModeLabel, getTypeLabel } from '../../../lib/pricing';
import { formatTimeParis } from '../../../utils/date';
import { getTriageReasons } from '../../../utils/workbench';

export const WB_STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmé',
  declined: 'Refusé',
  rescheduled: 'Reporté',
  payment_pending: 'Paiement en attente',
  payment_received: 'Réglé',
  cancelled: 'Annulé',
};

/** Soft chip colors per the Figma spec (sauge / ambre doux / terracotta). */
export const WB_STATUS_CHIP: Record<AppointmentStatus, string> = {
  confirmed: 'bg-mint-100 text-mint-900',
  payment_received: 'bg-mint-100 text-mint-900',
  pending: 'bg-amber-100 text-amber-800',
  payment_pending: 'bg-amber-100 text-amber-800',
  rescheduled: 'bg-amber-100 text-amber-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-100 text-red-800',
};

export function StatusChip({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-sans ${WB_STATUS_CHIP[status]}`}
    >
      {WB_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Freshness indicator of the live appointments list (#165) — discreet text in
 * the Synthèse header zone. Renders nothing until the first successful poll,
 * then switches to the offline wording while polls keep failing (SC4, V3).
 */
export function FreshnessIndicator({
  lastUpdated,
  isStale,
}: {
  lastUpdated: string | null;
  isStale: boolean;
}) {
  if (lastUpdated === null) return null;
  return (
    <p aria-live="polite" className="mb-3 text-right text-xs text-sage-500 font-sans">
      {isStale
        ? `Données du ${formatTimeParis(lastUpdated)} — hors ligne`
        : `Mis à jour à ${formatTimeParis(lastUpdated)}`}
    </p>
  );
}

/** Derived "EN RETARD" badge — past-dated appointment still needing action. */
export function LateBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold font-sans uppercase tracking-wide text-amber-900">
      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      En retard
    </span>
  );
}

/** Initials avatar chip. */
export function Avatar({ name, className = '' }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-full bg-mint-100 font-serif text-sm font-semibold text-mint-900 shrink-0 ${className || 'w-11 h-11'}`}
    >
      {initials}
    </span>
  );
}

/** Light-green time block used in list rows: big time + duration. */
export function TimeBlock({ time, duration }: { time: string; duration: number }) {
  return (
    <span className="inline-flex flex-col items-center justify-center rounded-xl bg-mint-100 px-2.5 py-1.5 shrink-0">
      <span className="font-sans text-sm font-bold text-sage-900 tabular-nums leading-tight">{time}</span>
      <span className="font-sans text-[10px] text-sage-600 leading-tight">{duration} min</span>
    </span>
  );
}

/** Dark forest time badge used on "Prochains rendez-vous": time + AUJ./date. */
export function DarkTimeBadge({ time, day }: { time: string; day: string }) {
  return (
    <span className="inline-flex flex-col items-center justify-center rounded-xl bg-sage-900 px-3 py-1.5 text-white shrink-0">
      <span className="font-sans text-sm font-semibold tabular-nums leading-tight">{time}</span>
      <span className="font-sans text-[10px] uppercase tracking-wide text-sage-300 leading-tight">{day}</span>
    </span>
  );
}

/** Marker for designed-but-not-built features (tracked in #142–#147). */
export function Prochainement({ issue }: { issue: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold font-sans uppercase tracking-wide text-sage-600"
      title={`Fonctionnalité prévue par la maquette — à construire (issue #${issue})`}
    >
      Prochainement · #{issue}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ModalOverlay — accessible dialog shell shared by the drawer and both sheets
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalOverlayProps {
  label: string;
  onClose: () => void;
  /** Classes of the focusable panel (side drawer or bottom sheet). */
  panelClassName: string;
  children: React.ReactNode;
}

/**
 * Overlay dialog implementing the same keyboard contract as the proposal-A
 * creation modal (AdminCreateModal): initial focus on the panel, Tab/Shift+Tab
 * containment, Escape to close, focus restored to the trigger on unmount.
 * Backdrop click also closes.
 */
export function ModalOverlay({ label, onClose, panelClassName, children }: ModalOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // Consumers pass inline closures: keying the effect on onClose would re-run
  // the mount effect on every parent render and corrupt previousFocusRef.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Focus the first control (fallback: the panel) — the backdrop button sits
    // outside the panel's Tab cycle, so starting on the panel itself would let
    // Shift+Tab escape into it (revue #149).
    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panelRef.current)?.focus();
    }, 0);

    function trap(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!panelRef.current.contains(document.activeElement)) {
        // Focus drifted outside the panel (backdrop, browser chrome) — fold it
        // back into the cycle instead of letting Tab leave the dialog.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      window.clearTimeout(focusTimer);
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-black/40 cursor-default focus:outline-hidden"
      />
      <div ref={panelRef} tabIndex={-1} className={`focus:outline-hidden ${panelClassName}`}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppointmentRow — carte de rendez-vous partagée
// ---------------------------------------------------------------------------

interface AppointmentRowProps {
  appointment: Appointment;
  onClick: () => void;
  /** État sélectionné (liste Rendez-vous uniquement). */
  selected?: boolean;
  ariaLabel: string;
}

/**
 * Carte unique des listes de rendez-vous — même rendu dans la file « À
 * traiter » (Synthèse) et la liste Rendez-vous, sur iPad comme sur mobile :
 * bloc horaire (heure + durée), patient + badges, sous-titre type · mode,
 * statut, accès à la fiche (« Détails » ≥ sm, chevron sur mobile).
 * Le badge « EN RETARD » est dérivé de la règle de triage unique
 * (statut actionnable + date passée).
 */
export function AppointmentRow({ appointment, onClick, selected = false, ariaLabel }: AppointmentRowProps) {
  const late = getTriageReasons(appointment)?.late ?? false;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={`
        w-full flex items-center gap-3 px-4 py-3 text-left rounded-2xl
        border bg-white shadow-xs transition-colors
        hover:border-mint-300 focus:outline-hidden focus:ring-2 focus:ring-mint-400
        min-h-[64px]
        ${selected ? 'border-l-4 border-l-sage-900 border-sage-200' : late ? 'border-l-4 border-l-amber-400 border-sage-200' : 'border-sage-200'}
      `}
    >
      <TimeBlock time={formatTimeParis(appointment.scheduled_at)} duration={appointment.duration} />
      <span className="flex-1 min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-serif text-base font-semibold text-sage-900 truncate">
            {appointment.patient_name}
          </span>
          {late && <LateBadge />}
          <StatusChip status={appointment.status} />
        </span>
        <span className="block text-xs text-sage-600 font-sans mt-0.5 truncate">
          {getTypeLabel(appointment.appointment_type)} · {getModeLabel(appointment.appointment_mode)}
        </span>
      </span>
      <span className="hidden sm:inline-flex items-center gap-1 text-sm font-medium font-sans text-sage-600 shrink-0">
        Détails
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </span>
      <svg className="sm:hidden w-4 h-4 text-sage-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
