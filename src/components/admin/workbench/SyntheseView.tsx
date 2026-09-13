/**
 * SyntheseView — section « Synthèse » du poste de travail (rework #164).
 *
 * Ordre de lecture (SC1) : « Prochains rendez-vous » en tête, puis la file
 * « Demandes de RDV » — actions thérapeute uniquement (demandes `pending` +
 * reports `rescheduled` expirés côté patient) ; les `payment_pending` n'y
 * figurent jamais (le lien de paiement travaille seul).
 *
 * Cartes KPI : 1. Aujourd'hui (bascule « Demain » quand plus aucune séance
 * active du jour Paris n'est non terminée — SC5), 2. Ma semaine (SC4),
 * 3. Demandes de RDV (la carte EST un bouton → `onOpenDemandes`, threaded
 * par Workbench), 4. Volume mensuel (l'ancienne carte désactivée de
 * capacité disparaît — issue #146 re-scopée séparément).
 *
 * `nowMs` est figé au montage : un rechargement de la page rafraîchit les
 * données SSR (même arbitrage que la proposition A).
 */

import { useMemo, useState } from 'react';
import type { Appointment } from '../../../types/appointment';
import { getTypeLabel } from '../../../lib/pricing';
import { formatTimeParis, isSameParisDay } from '../../../utils/date';
import {
  getDemandItems,
  getMinutesUntil,
  getMonthlyVolume,
  getNextSessions,
  getTodaySessions,
  getTomorrowSessions,
  getWeekSessions,
} from '../../../utils/workbench';
import { AppointmentRow, DarkTimeBadge } from './ui';

interface SyntheseViewProps {
  appointments: Appointment[];
  onFocusAppointment: (appointmentId: string) => void;
  /** KPI « Demandes de RDV » click-through: Rendez-vous tab, demandes filter preselected. */
  onOpenDemandes: () => void;
}

const DEMANDS_PREVIEW_COUNT = 4;

/**
 * French week interval from Paris day keys — « 15–21 sept. » (same month)
 * or « 29 sept. – 5 oct. » (cross-month). Day keys are pure dates: they are
 * parsed on the UTC axis (`Date.UTC`) so the runtime timezone cannot shift
 * the day.
 */
function formatWeekInterval(startKey: string, endKey: string): string {
  const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
  const [endYear, endMonth, endDay] = endKey.split('-').map(Number);
  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
  const dayMonth = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  if (startMonth === endMonth) return `${startDay}–${dayMonth.format(end)}`;
  return `${dayMonth.format(start)} – ${dayMonth.format(end)}`;
}

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

interface KpiCardProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  valueSuffix?: string;
  detail: React.ReactNode;
  tone?: 'default' | 'warning';
  /** When set, the whole card renders as one keyboard-operable <button>. */
  onClick?: () => void;
  /** Explicit accessible name for the button variant. */
  accessibleName?: string;
}

function KpiCard({
  label,
  icon,
  value,
  valueSuffix,
  detail,
  tone = 'default',
  onClick,
  accessibleName,
}: KpiCardProps) {
  const isWarning = tone === 'warning';
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-500 truncate">
          {label}
        </p>
        <span className={isWarning ? 'text-amber-500' : 'text-sage-400'}>
          {icon}
        </span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5 flex-wrap">
        <span className="font-serif text-3xl font-semibold text-sage-900">
          {value}
        </span>
        {valueSuffix && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold font-sans ${
              isWarning
                ? 'bg-amber-100 text-amber-800'
                : 'bg-sage-100 text-sage-600'
            }`}
          >
            {valueSuffix}
          </span>
        )}
      </p>
      <p
        className={`mt-1.5 text-xs font-sans ${isWarning ? 'text-amber-800' : 'text-sage-500'}`}
      >
        {detail}
      </p>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={accessibleName}
        className={`
          w-full rounded-2xl border bg-white p-4 shadow-sm min-w-0 text-left
          transition-colors hover:border-mint-300 focus:outline-none
          focus:ring-2 focus:ring-mint-400
          ${isWarning ? 'border-amber-200' : 'border-sage-200'}
        `}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={`
        rounded-2xl border bg-white p-4 shadow-sm min-w-0
        ${isWarning ? 'border-amber-200' : 'border-sage-200'}
      `}
    >
      {body}
    </div>
  );
}

export function SyntheseView({
  appointments,
  onFocusAppointment,
  onOpenDemandes,
}: SyntheseViewProps) {
  const [nowMs] = useState(() => Date.now());
  const [showAllDemands, setShowAllDemands] = useState(false);

  const {
    todaySessions,
    todayRemaining,
    nextConsultationTime,
    isDayOver,
    tomorrowCount,
    tomorrowFirstStart,
    week,
    weekInterval,
    demands,
    lateDemandCount,
    nextUpcoming,
    monthly,
  } = useMemo(() => {
    const today = getTodaySessions(appointments, nowMs);
    const upcoming = getNextSessions(appointments, nowMs, 3);
    const nextToday = upcoming.find(a =>
      isSameParisDay(a.scheduled_at, new Date(nowMs).toISOString()),
    );
    const futureToday = today.filter(
      a => new Date(a.scheduled_at).getTime() >= nowMs,
    );
    // SC5 — the day is over when NO active session of today (Paris) is
    // unfinished: upcoming (start ≥ now), or already started with a planned
    // end (start + duration) still ahead of the frozen mount time.
    const isDayOver = !today.some(appointment => {
      const startMs = Date.parse(appointment.scheduled_at);
      return (
        startMs >= nowMs || startMs + appointment.duration * 60_000 > nowMs
      );
    });
    const tomorrow = getTomorrowSessions(appointments, nowMs);
    const weekSummary = getWeekSessions(appointments, nowMs);
    const demandItems = getDemandItems(appointments, nowMs);
    return {
      todaySessions: today,
      todayRemaining: futureToday.length,
      nextConsultationTime: nextToday
        ? formatTimeParis(nextToday.scheduled_at)
        : null,
      isDayOver,
      tomorrowCount: tomorrow.sessions.length,
      tomorrowFirstStart: tomorrow.firstStartIso,
      week: weekSummary,
      weekInterval: formatWeekInterval(
        weekSummary.weekStartKey,
        weekSummary.weekEndKey,
      ),
      demands: demandItems,
      lateDemandCount: demandItems.filter(
        a => Date.parse(a.scheduled_at) < nowMs,
      ).length,
      nextUpcoming: upcoming,
      monthly: getMonthlyVolume(appointments, nowMs),
    };
  }, [appointments, nowMs]);

  const dayLabel = isDayOver ? 'Demain' : 'Aujourd’hui';
  const dayValue = isDayOver ? tomorrowCount : todaySessions.length;
  const dayDetail = isDayOver
    ? tomorrowFirstStart
      ? `Prochaine consultation à ${formatTimeParis(tomorrowFirstStart)}`
      : 'Aucune séance'
    : nextConsultationTime
      ? `Prochaine consultation à ${nextConsultationTime}`
      : todayRemaining === 0 && todaySessions.length > 0
        ? 'Plus de séance aujourd’hui'
        : 'Aucune séance aujourd’hui';

  const visibleDemands = showAllDemands
    ? demands
    : demands.slice(0, DEMANDS_PREVIEW_COUNT);
  const hiddenDemandsCount = demands.length - visibleDemands.length;

  return (
    <div className="space-y-5">
      {/* ── Cartes d'indicateurs ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={dayLabel}
          icon={
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
              />
            </svg>
          }
          value={String(dayValue)}
          valueSuffix={
            dayValue > 1 ? 'séances programmées' : 'séance programmée'
          }
          detail={dayDetail}
        />
        <KpiCard
          label={week.label}
          icon={
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21a9 9 0 119-9 9 9 0 01-9 9zm0-9V3"
              />
            </svg>
          }
          value={String(week.count)}
          valueSuffix={week.count > 1 ? 'séances' : 'séance'}
          detail={weekInterval}
        />
        <KpiCard
          label="Demandes de RDV"
          icon={
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z"
              />
            </svg>
          }
          value={String(demands.length)}
          valueSuffix="à traiter"
          detail={
            lateDemandCount > 0
              ? `${lateDemandCount} en retard`
              : 'Aucune demande en attente'
          }
          tone={demands.length > 0 ? 'warning' : 'default'}
          onClick={onOpenDemandes}
          accessibleName="Demandes de RDV — voir les demandes à traiter dans l’onglet Rendez-vous"
        />
        <KpiCard
          label="Volume mensuel"
          icon={
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
          }
          value={String(monthly.total)}
          valueSuffix="rendez-vous"
          detail={
            monthly.honoredSharePct === null ? (
              'Aucun rendez-vous ce mois-ci'
            ) : (
              <span className="inline-flex items-center gap-1">
                <svg
                  className="w-3.5 h-3.5 text-mint-600"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                    clipRule="evenodd"
                  />
                </svg>
                {monthly.honoredSharePct}
                {'\u00a0'}% honorés ou reportés
              </span>
            )
          }
        />
      </div>

      {/* ── Prochains rendez-vous ─────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-sage-200 bg-white p-4 sm:p-5 shadow-sm"
        aria-labelledby="wb-next-title"
      >
        <header className="flex flex-wrap items-center gap-2.5 mb-3">
          <span
            className="w-2 h-2 rounded-full bg-sage-900"
            aria-hidden="true"
          />
          <h2
            id="wb-next-title"
            className="font-serif text-lg font-semibold text-sage-900"
          >
            Prochains rendez-vous
            {nextUpcoming.length > 0 && (
              <span className="ml-1.5">({nextUpcoming.length})</span>
            )}
          </h2>
          <span className="ml-auto text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-400">
            Séances à venir
          </span>
        </header>

        {nextUpcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sage-300 px-4 py-5 text-sm text-sage-500 font-sans text-center">
            Aucun rendez-vous à venir.
          </p>
        ) : (
          <ul className="space-y-2">
            {nextUpcoming.map(appointment => {
              const minutes = getMinutesUntil(appointment.scheduled_at, nowMs);
              const canJoin =
                appointment.appointment_mode === 'video' &&
                appointment.video_link;
              return (
                <li
                  key={appointment.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-sage-200 bg-white px-3.5 py-2.5 min-h-[64px]"
                >
                  <DarkTimeBadge
                    time={formatTimeParis(appointment.scheduled_at)}
                    day={formatDayChip(appointment.scheduled_at, nowMs)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-serif text-base font-semibold text-sage-900 truncate">
                        {appointment.patient_name}
                      </span>
                      {minutes !== null && minutes < 120 && (
                        <span className="inline-flex items-center rounded-full bg-mint-100 px-2 py-0.5 text-[10px] font-bold font-sans uppercase tracking-wide text-mint-800">
                          Dans {minutes} min
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-sage-500 font-sans mt-0.5 truncate">
                      {getTypeLabel(appointment.appointment_type)} ·{' '}
                      {appointment.appointment_mode === 'video'
                        ? 'Téléconsultation'
                        : 'Présentiel au cabinet'}
                    </span>
                  </span>
                  {canJoin ? (
                    <a
                      href={appointment.video_link ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="
                        inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold font-sans
                        rounded-xl bg-sage-900 text-white hover:bg-sage-800 focus:outline-none
                        focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors
                        min-h-[40px] shrink-0
                      "
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 8.5l2.77-1.85A1 1 0 0118.3 7.5v5a1 1 0 01-1.53.85L14 11.5v-3z" />
                      </svg>
                      Rejoindre la visio
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onFocusAppointment(appointment.id)}
                      aria-label={`Voir les détails du rendez-vous de ${appointment.patient_name}`}
                      className="
                        inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium font-sans
                        rounded-xl bg-mint-100 text-mint-900 hover:bg-mint-200 focus:outline-none
                        focus:ring-2 focus:ring-mint-400 transition-colors min-h-[40px] shrink-0
                      "
                    >
                      Détails
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Demandes de RDV ───────────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-sage-200 bg-white p-4 sm:p-5 shadow-sm"
        aria-labelledby="wb-demandes-title"
      >
        <header className="flex flex-wrap items-center gap-2.5 mb-3">
          <span
            className="w-2 h-2 rounded-full bg-amber-400"
            aria-hidden="true"
          />
          <h2
            id="wb-demandes-title"
            className="font-serif text-lg font-semibold text-sage-900"
          >
            Demandes de RDV
            {demands.length > 0 && (
              <span className="ml-1.5">· {demands.length}</span>
            )}
          </h2>
          {demands.length > 0 && (
            <span className="ml-auto inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold font-sans uppercase tracking-wide text-amber-800">
              Actions requises
            </span>
          )}
        </header>

        {demands.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sage-300 px-4 py-5 text-sm text-sage-500 font-sans text-center">
            Aucune demande en attente — tout est à jour.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleDemands.map(appointment => (
                <li key={appointment.id}>
                  <AppointmentRow
                    appointment={appointment}
                    onClick={() => onFocusAppointment(appointment.id)}
                    ariaLabel={`Ouvrir : ${appointment.patient_name}, ${formatTimeParis(appointment.scheduled_at)}`}
                  />
                </li>
              ))}
            </ul>
            {demands.length > DEMANDS_PREVIEW_COUNT && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllDemands(!showAllDemands)}
                  aria-expanded={showAllDemands}
                  className="
                    inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-mint-100 text-sm
                    font-medium font-sans text-mint-900 hover:bg-mint-200 focus:outline-none
                    focus:ring-2 focus:ring-mint-400 transition-colors min-h-[40px]
                  "
                >
                  {showAllDemands
                    ? 'Réduire'
                    : `Voir les ${hiddenDemandsCount} autres demandes`}
                  <svg
                    className={`w-4 h-4 transition-transform ${showAllDemands ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
