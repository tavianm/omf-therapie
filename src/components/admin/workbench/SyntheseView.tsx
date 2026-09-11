/**
 * SyntheseView — proposal-B dashboard home ("Synthèse" section, issue #148).
 *
 * Everything shown here is derived client-side from the SSR-fetched
 * appointment list (see `utils/workbench.ts` for the pure helpers):
 *   - KPI cards: today's sessions, triage queue size, monthly volume
 *   - "À traiter" queue: appointments needing a decision, with the derived
 *     "EN RETARD" flag; each row focuses the appointment in the Rendez-vous
 *     section (full actions live in <AppointmentCard/> — no duplication)
 *   - "Prochains rendez-vous": next sessions with join-video / details
 *
 * `nowMs` is frozen once per mount: a live dashboard refresh is out of scope
 * (reloading the page refetches SSR data anyway).
 */

import { useMemo, useState } from 'react';
import type { Appointment, AppointmentStatus } from '../../../types/appointment';
import { getModeLabel } from '../../../lib/pricing';
import { formatTimeParis, isSameParisDay } from '../../../utils/date';
import { STATUS_BADGE, STATUS_LABELS } from '../AppointmentCard';
import {
  getMinutesUntil,
  getMonthlyVolume,
  getNextSessions,
  getTodaySessions,
  getTriageBreakdown,
  getTriageItems,
} from '../../../utils/workbench';

interface SyntheseViewProps {
  appointments: Appointment[];
  onFocusAppointment: (appointmentId: string) => void;
}

const TRIAGE_ACTION_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Confirmer',
  confirmed: 'Détails',
  declined: 'Détails',
  rescheduled: 'Replanifier',
  payment_pending: 'Paiement',
  payment_received: 'Détails',
  cancelled: 'Détails',
};

/** Short uppercase chip for a session day: "AUJ." today, "12 SEPT" otherwise. */
function formatDayChip(iso: string, nowMs: number): string {
  if (isSameParisDay(iso, new Date(nowMs).toISOString())) return 'AUJ.';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/Paris',
  })
    .format(new Date(iso))
    .replace('.', '')
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string;
  subLabel: string;
  detail?: string;
  accent?: boolean;
}

function KpiCard({ label, value, subLabel, detail, accent }: KpiCardProps) {
  return (
    <div
      className={`
        rounded-2xl border p-5 shadow-sm
        ${accent ? 'border-amber-200 bg-amber-50' : 'border-sage-200 bg-white'}
      `}
    >
      <p
        className={`
          text-xs font-semibold font-sans uppercase tracking-wider
          ${accent ? 'text-amber-700' : 'text-sage-500'}
        `}
      >
        {label}
      </p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="font-serif text-3xl font-semibold text-sage-900">{value}</span>
        <span
          className={`
            inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-sans
            ${accent ? 'bg-amber-200 text-amber-900' : 'bg-sage-100 text-sage-600'}
          `}
        >
          {subLabel}
        </span>
      </p>
      {detail && (
        <p className={`mt-1.5 text-sm font-sans ${accent ? 'text-amber-800' : 'text-sage-500'}`}>
          {detail}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SyntheseView({ appointments, onFocusAppointment }: SyntheseViewProps) {
  const [nowMs] = useState(() => Date.now());

  const { triageItems, breakdown, todaySessions, nextUpcoming, monthly, nextConsultationTime } =
    useMemo(() => {
      const triage = getTriageItems(appointments, nowMs);
      const today = getTodaySessions(appointments, nowMs);
      const upcoming = getNextSessions(appointments, nowMs, 3);
      const nextToday = upcoming.find((a) => isSameParisDay(a.scheduled_at, new Date(nowMs).toISOString()));
      return {
        triageItems: triage,
        breakdown: getTriageBreakdown(triage),
        todaySessions: today,
        nextUpcoming: upcoming,
        monthly: getMonthlyVolume(appointments, nowMs),
        nextConsultationTime: nextToday ? formatTimeParis(nextToday.scheduled_at) : null,
      };
    }, [appointments, nowMs]);

  const triageBreakdownLabel = [
    breakdown.late > 0 ? `${breakdown.late} retard${breakdown.late > 1 ? 's' : ''}` : null,
    breakdown.payment > 0 ? `${breakdown.payment} paiement${breakdown.payment > 1 ? 's' : ''}` : null,
    breakdown.reschedule > 0 ? `${breakdown.reschedule} report${breakdown.reschedule > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-8">
      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Indicateurs clés">
        <div role="listitem">
          <KpiCard
            label="Aujourd'hui"
            value={String(todaySessions.length)}
            subLabel={todaySessions.length > 1 ? 'séances' : 'séance'}
            detail={
              nextConsultationTime
                ? `Prochaine consultation à ${nextConsultationTime}`
                : todaySessions.length > 0
                  ? 'Plus de séance aujourd\u2019hui'
                  : 'Aucune séance aujourd\u2019hui'
            }
          />
        </div>
        <div role="listitem">
          <KpiCard
            label="À traiter / urgences"
            value={String(triageItems.length)}
            subLabel="Action requise"
            detail={triageBreakdownLabel || 'Aucune action en attente'}
            accent={triageItems.length > 0}
          />
        </div>
        <div role="listitem" className="sm:col-span-2 lg:col-span-1">
          <KpiCard
            label="Volume mensuel"
            value={String(monthly.total)}
            subLabel="rendez-vous"
            detail={
              monthly.honoredSharePct === null
                ? 'Aucun rendez-vous ce mois-ci'
                : `${monthly.honoredSharePct}\u00a0% honorés ou reportés`
            }
          />
        </div>
      </div>

      {/* ── À traiter ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="triage-heading">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 id="triage-heading" className="font-serif text-lg font-semibold text-sage-800">
            À traiter
            {triageItems.length > 0 && <span className="ml-1.5">· {triageItems.length}</span>}
          </h2>
          {triageItems.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold font-sans uppercase tracking-wide text-amber-800">
              Actions requises
            </span>
          )}
        </div>

        {triageItems.length === 0 ? (
          <p className="rounded-2xl border border-sage-200 bg-white px-5 py-6 text-sm text-sage-500 font-sans">
            Aucune action requise — tout est à jour.
          </p>
        ) : (
          <ul className="space-y-2">
            {triageItems.map(({ appointment, reasons }) => {
              const isLate = reasons.late;
              return (
                <li key={appointment.id}>
                  <button
                    type="button"
                    onClick={() => onFocusAppointment(appointment.id)}
                    aria-label={`${TRIAGE_ACTION_LABELS[appointment.status]} : ${appointment.patient_name}, ${formatTimeParis(appointment.scheduled_at)}`}
                    className={`
                      w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl
                      border bg-white shadow-sm transition-colors
                      hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
                      min-h-[56px]
                      ${isLate ? 'border-l-4 border-l-amber-400 border-sage-200' : 'border-sage-200'}
                    `}
                  >
                    <span className="font-sans text-sm font-semibold text-sage-900 w-14 shrink-0 tabular-nums">
                      {formatTimeParis(appointment.scheduled_at)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-sage-900 font-sans truncate">
                          {appointment.patient_name}
                        </span>
                        {isLate && (
                          <span className="inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold font-sans uppercase tracking-wide text-amber-900 shrink-0">
                            En retard
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-sage-500 font-sans truncate">
                        {getModeLabel(appointment.appointment_mode)} · {appointment.duration} min
                      </span>
                    </span>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium font-sans shrink-0 ${STATUS_BADGE[appointment.status]}`}
                    >
                      {STATUS_LABELS[appointment.status]}
                    </span>
                    <span className="hidden sm:inline-flex items-center gap-1 text-sm font-medium font-sans text-mint-700 shrink-0">
                      {TRIAGE_ACTION_LABELS[appointment.status]}
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Prochains rendez-vous ─────────────────────────────────────────── */}
      <section aria-labelledby="next-heading">
        <h2 id="next-heading" className="font-serif text-lg font-semibold text-sage-800 mb-3">
          Prochains rendez-vous
          {nextUpcoming.length > 0 && <span className="ml-1.5">({nextUpcoming.length})</span>}
        </h2>

        {nextUpcoming.length === 0 ? (
          <p className="rounded-2xl border border-sage-200 bg-white px-5 py-6 text-sm text-sage-500 font-sans">
            Aucun rendez-vous à venir.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {nextUpcoming.map((appointment) => {
              const minutes = getMinutesUntil(appointment.scheduled_at, nowMs);
              const canJoin = appointment.appointment_mode === 'video' && appointment.video_link;
              return (
                <li
                  key={appointment.id}
                  className="rounded-2xl border border-sage-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex flex-col items-center rounded-xl bg-sage-900 px-3 py-1.5 text-white shrink-0">
                      <span className="font-sans text-sm font-semibold tabular-nums leading-tight">
                        {formatTimeParis(appointment.scheduled_at)}
                      </span>
                      <span className="font-sans text-[10px] uppercase tracking-wide text-sage-300 leading-tight">
                        {formatDayChip(appointment.scheduled_at, nowMs)}
                      </span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-sage-900 font-sans truncate">
                        {appointment.patient_name}
                      </p>
                      {minutes !== null && minutes < 120 && (
                        <span className="inline-flex items-center rounded-full bg-mint-100 px-2 py-0.5 text-[11px] font-semibold font-sans text-mint-800 mt-0.5">
                          Dans {minutes} min
                        </span>
                      )}
                      <p className="text-xs text-sage-500 font-sans mt-0.5 truncate">
                        {getModeLabel(appointment.appointment_mode)} · {appointment.duration} min
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canJoin && (
                      <a
                        href={appointment.video_link ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="
                          inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold font-sans
                          rounded-xl bg-mint-700 text-white shadow-sm hover:bg-mint-800
                          focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
                          transition-colors min-h-[40px]
                        "
                      >
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 8.5l2.77-1.85A1 1 0 0118.3 7.5v5a1 1 0 01-1.53.85L14 11.5v-3z" />
                        </svg>
                        Rejoindre la visio
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onFocusAppointment(appointment.id)}
                      aria-label={`Voir les détails du rendez-vous de ${appointment.patient_name}`}
                      className="
                        inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium font-sans
                        rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50
                        focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
                        transition-colors min-h-[40px]
                      "
                    >
                      Détails
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
