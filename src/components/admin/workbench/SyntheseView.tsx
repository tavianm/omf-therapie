/**
 * SyntheseView — section « Synthèse » du poste de travail (proposition B,
 * issue #148). Fidèle à l'écran Figma « Synthèse iPad Épurée (Harmonisée) » :
 *
 *  - 4 cartes d'indicateurs : Aujourd'hui, À traiter / urgences, Volume
 *    mensuel (dérivés des rendez-vous SSR) + Remplissage (sans backend —
 *    rendu désactivé, issue #146)
 *  - carte « À traiter » : file des RDV à traiter (pending /
 *    payment_pending / rescheduled) avec badge dérivé « EN RETARD »,
 *    repliée sur 4 lignes puis expander ; chaque ligne renvoie au RDV dans
 *    la section Rendez-vous (les actions complètes restent dans
 *    <AppointmentDetail/> — aucune duplication de logique métier)
 *  - carte « Prochains rendez-vous » : accès visio direct / détails
 *
 * `nowMs` est figé au montage : un rechargement de la page rafraîchit les
 * données SSR (même arbitrage que la proposition A).
 */

import { useMemo, useState } from 'react';
import type { Appointment } from '../../../types/appointment';
import { getModeLabel, getTypeLabel } from '../../../lib/pricing';
import { formatTimeParis, isSameParisDay } from '../../../utils/date';
import {
  getMinutesUntil,
  getMonthlyVolume,
  getNextSessions,
  getTodaySessions,
  getTriageBreakdown,
  getTriageItems,
} from '../../../utils/workbench';
import { DarkTimeBadge, LateBadge, Prochainement, StatusChip, TimeBlock } from './ui';

interface SyntheseViewProps {
  appointments: Appointment[];
  onFocusAppointment: (appointmentId: string) => void;
}

const TRIAGE_PREVIEW_COUNT = 4;

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
  disabledChip?: React.ReactNode;
}

function KpiCard({ label, icon, value, valueSuffix, detail, tone = 'default', disabledChip }: KpiCardProps) {
  const isWarning = tone === 'warning';
  return (
    <div
      className={`
        rounded-2xl border bg-white p-4 shadow-sm min-w-0
        ${isWarning ? 'border-amber-200' : 'border-sage-200'}
      `}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-500 truncate">
          {label}
        </p>
        <span className={isWarning ? 'text-amber-500' : 'text-sage-400'}>{icon}</span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5 flex-wrap">
        <span className="font-serif text-3xl font-semibold text-sage-900">{value}</span>
        {valueSuffix && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold font-sans ${
              isWarning ? 'bg-amber-100 text-amber-800' : 'bg-sage-100 text-sage-600'
            }`}
          >
            {valueSuffix}
          </span>
        )}
        {disabledChip}
      </p>
      <p className={`mt-1.5 text-xs font-sans ${isWarning ? 'text-amber-800' : 'text-sage-500'}`}>{detail}</p>
    </div>
  );
}

export function SyntheseView({ appointments, onFocusAppointment }: SyntheseViewProps) {
  const [nowMs] = useState(() => Date.now());
  const [showAllTriage, setShowAllTriage] = useState(false);

  const { triageItems, breakdown, todaySessions, nextUpcoming, monthly, nextConsultationTime, todayRemaining } =
    useMemo(() => {
      const triage = getTriageItems(appointments, nowMs);
      const today = getTodaySessions(appointments, nowMs);
      const upcoming = getNextSessions(appointments, nowMs, 3);
      const nextToday = upcoming.find((a) => isSameParisDay(a.scheduled_at, new Date(nowMs).toISOString()));
      const futureToday = today.filter((a) => new Date(a.scheduled_at).getTime() >= nowMs);
      return {
        triageItems: triage,
        breakdown: getTriageBreakdown(triage),
        todaySessions: today,
        nextUpcoming: upcoming,
        monthly: getMonthlyVolume(appointments, nowMs),
        nextConsultationTime: nextToday ? formatTimeParis(nextToday.scheduled_at) : null,
        todayRemaining: futureToday.length,
      };
    }, [appointments, nowMs]);

  const triageBreakdownLabel = [
    breakdown.late > 0 ? `${breakdown.late} retard${breakdown.late > 1 ? 's' : ''}` : null,
    breakdown.payment > 0 ? `${breakdown.payment} paiement${breakdown.payment > 1 ? 's' : ''}` : null,
    breakdown.reschedule > 0 ? `${breakdown.reschedule} report${breakdown.reschedule > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const visibleTriage = showAllTriage ? triageItems : triageItems.slice(0, TRIAGE_PREVIEW_COUNT);
  const hiddenTriageCount = triageItems.length - visibleTriage.length;

  return (
    <div className="space-y-5">
      {/* ── Cartes d'indicateurs ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Remplissage"
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 119-9 9 9 0 01-9 9zm0-9V3" />
            </svg>
          }
          value="—"
          detail="Indicateur de capacité"
          disabledChip={<Prochainement issue={146} />}
        />
        <KpiCard
          label="Aujourd'hui"
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          }
          value={String(todaySessions.length)}
          valueSuffix={todaySessions.length > 1 ? 'séances programmées' : 'séance programmée'}
          detail={
            nextConsultationTime
              ? `Prochaine consultation à ${nextConsultationTime}`
              : todayRemaining === 0 && todaySessions.length > 0
                ? 'Plus de séance aujourd’hui'
                : 'Aucune séance aujourd’hui'
          }
        />
        <KpiCard
          label="À traiter / urgences"
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          }
          value={String(triageItems.length)}
          valueSuffix="Action requise"
          detail={triageBreakdownLabel || 'Aucune action en attente'}
          tone={triageItems.length > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Volume mensuel"
          icon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          }
          value={String(monthly.total)}
          valueSuffix="rendez-vous"
          detail={
            monthly.honoredSharePct === null ? (
              'Aucun rendez-vous ce mois-ci'
            ) : (
              <span className="inline-flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-mint-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                {monthly.honoredSharePct}
                {'\u00a0'}% honorés ou reportés
              </span>
            )
          }
        />
      </div>

      {/* ── À traiter ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-sage-200 bg-white p-4 sm:p-5 shadow-sm" aria-labelledby="wb-triage-title">
        <header className="flex flex-wrap items-center gap-2.5 mb-3">
          <span className="w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />
          <h2 id="wb-triage-title" className="font-serif text-lg font-semibold text-sage-900">
            À traiter
            {triageItems.length > 0 && <span className="ml-1.5">· {triageItems.length}</span>}
          </h2>
          {triageItems.length > 0 && (
            <span className="ml-auto inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold font-sans uppercase tracking-wide text-amber-800">
              Actions requises
            </span>
          )}
        </header>

        {triageItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-sage-300 px-4 py-5 text-sm text-sage-500 font-sans text-center">
            Aucune action requise — tout est à jour.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleTriage.map(({ appointment, reasons }) => (
                <li key={appointment.id}>
                  <button
                    type="button"
                    onClick={() => onFocusAppointment(appointment.id)}
                    aria-label={`Ouvrir : ${appointment.patient_name}, ${formatTimeParis(appointment.scheduled_at)}`}
                    className="
                      w-full flex items-center gap-3 px-3.5 py-2.5 text-left rounded-xl
                      border border-sage-200 bg-white transition-colors
                      hover:border-mint-300 hover:bg-mint-50/50
                      focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[56px]
                    "
                  >
                    <TimeBlock time={formatTimeParis(appointment.scheduled_at)} duration={appointment.duration} />
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-serif text-base font-semibold text-sage-900 truncate">
                          {appointment.patient_name}
                        </span>
                        {reasons.late && <LateBadge />}
                      </span>
                      <span className="block text-xs text-sage-500 font-sans mt-0.5 truncate">
                        {getTypeLabel(appointment.appointment_type)} · {getModeLabel(appointment.appointment_mode)}
                      </span>
                    </span>
                    <StatusChip status={appointment.status} />
                    <svg className="w-4 h-4 text-sage-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            {triageItems.length > TRIAGE_PREVIEW_COUNT && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllTriage(!showAllTriage)}
                  aria-expanded={showAllTriage}
                  className="
                    inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-mint-100 text-sm
                    font-medium font-sans text-mint-900 hover:bg-mint-200 focus:outline-none
                    focus:ring-2 focus:ring-mint-400 transition-colors min-h-[40px]
                  "
                >
                  {showAllTriage ? 'Réduire' : `Voir les ${hiddenTriageCount} autres urgences`}
                  <svg
                    className={`w-4 h-4 transition-transform ${showAllTriage ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Prochains rendez-vous ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-sage-200 bg-white p-4 sm:p-5 shadow-sm" aria-labelledby="wb-next-title">
        <header className="flex flex-wrap items-center gap-2.5 mb-3">
          <span className="w-2 h-2 rounded-full bg-sage-900" aria-hidden="true" />
          <h2 id="wb-next-title" className="font-serif text-lg font-semibold text-sage-900">
            Prochains rendez-vous
            {nextUpcoming.length > 0 && <span className="ml-1.5">({nextUpcoming.length})</span>}
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
            {nextUpcoming.map((appointment) => {
              const minutes = getMinutesUntil(appointment.scheduled_at, nowMs);
              const canJoin = appointment.appointment_mode === 'video' && appointment.video_link;
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
                      {appointment.appointment_mode === 'video' ? 'Téléconsultation' : 'Présentiel au cabinet'}
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
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
    </div>
  );
}
