/**
 * Shared UI atoms for the workbench (proposal B) — visual language taken from
 * the Figma file "Refonte admin": soft status chips, forest-green time blocks,
 * serif headings, 44px touch targets. Proposal B uses its own status labels
 * ("Réglé" instead of "Paiement reçu") per the mockups.
 */

import type { AppointmentStatus } from '../../../types/appointment';

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
      <span className="font-sans text-[10px] text-sage-500 leading-tight">{duration} min</span>
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
      className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold font-sans uppercase tracking-wide text-sage-500"
      title={`Fonctionnalité prévue par la maquette — à construire (issue #${issue})`}
    >
      Prochainement · #{issue}
    </span>
  );
}
