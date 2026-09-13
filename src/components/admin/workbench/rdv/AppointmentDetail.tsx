/**
 * AppointmentDetail — fiche d'un rendez-vous (proposition B, issue #148).
 *
 * Fidèle à l'écran « Détail RDV » du Figma : identité + statut, pilules de
 * contact, cartes Date/Modalité/Type/Règlement, notes internes avec
 * sauvegarde, actions contextuelles. Utilisé dans le panneau droit du
 * split-view iPad (`variant="pane"`) et en bottom sheet mobile
 * (`variant="sheet"`).
 *
 * Les actions appellent le contrat existant de PATCH /api/appointments/[id]/
 * (mêmes payloads que <AppointmentCard/> côté proposition A) puis rechargent
 * la page pour reflécher les données SSR — sauf la sauvegarde des notes,
 * qui reste locale comme sur la proposition A.
 */

import { useId, useState } from 'react';
import type { Appointment } from '../../../../types/appointment';
import { getTypeLabel, getModeLabel } from '../../../../lib/pricing';
import {
  formatDayHeader,
  formatTimeParis,
  getRelativeDayLabel,
  isCancellableByTherapist,
  isUpcoming,
} from '../../../../utils/date';
import { isReschedulable, type PatientAggregate } from '../../../../utils/workbench';
import { Avatar, StatusChip, WB_STATUS_LABELS } from '../ui';

/** Minimal patient context for the subtitle — derived by the caller. */
export interface AppointmentPatientSummary {
  isActive: boolean;
  sessionCount: number;
}

interface AppointmentDetailProps {
  appointment: Appointment;
  patient?: AppointmentPatientSummary | PatientAggregate | null;
  variant: 'pane' | 'sheet';
  onClose?: () => void;
  /**
   * Explicit data refetch after a successful mutation (#165) — replaces the
   * `window.location.reload()` call sites (wired through RendezVousView from
   * the Workbench polling hook). Consumed in a follow-up slice.
   */
  onRefresh?: () => void;
}

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(/\.00$/, '')} €`;
}

function paymentLabel(appointment: Appointment): string {
  if (appointment.status === 'payment_received') return 'Réglé';
  if (appointment.status === 'payment_pending') return 'En attente';
  if (appointment.appointment_mode === 'in-person') return 'Sur place';
  return 'Lien à envoyer';
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-mint-50 px-4 py-3">
      <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-500">
        {label}
      </p>
      <div className="mt-1 text-sm font-sans text-sage-900">{children}</div>
    </div>
  );
}

export function AppointmentDetail({ appointment, patient, variant, onClose }: AppointmentDetailProps) {
  // IDs uniques par instance : le détail est monté deux fois (panneau ≥ lg + sheet < lg),
  // des ids fixes dupliqueraient les associations label/contrôle (revue #148).
  const instanceId = useId();
  const [notes, setNotes] = useState(appointment.therapist_notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFlags, setConfirmFlags] = useState({
    firstSession: appointment.is_first_session,
    solidarity: false,
  });
  const [openPanel, setOpenPanel] = useState<'reschedule' | 'decline' | 'cancel' | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const isVideo = appointment.appointment_mode === 'video';
  const isDirectReschedule =
    appointment.status === 'confirmed' || appointment.status === 'payment_received';
  // Report possible depuis tout statut non terminal — y compris une
  // téléconsultation impayée, même en retard (port de 43fb1ac, #133) :
  // l'API `reschedule` expire le Payment Link d'origine et en régénère un
  // à l'acceptation, plutôt qu'un refus + re-création. La date d'origine
  // ne bloque pas ; seule la NOUVELLE date doit être future (contrôle API).
  const canReschedule = isReschedulable(appointment);
  const canCancel = isCancellableByTherapist(appointment);

  async function callPatch(payload: Record<string, unknown>, key: string) {
    setActionLoading(key);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      window.location.reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
      setActionLoading(null);
      return false;
    }
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'save_notes', therapist_notes: notes }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setNotesSaving(false);
    }
  }

  async function handleRegenerateCalendar() {
    setActionLoading('regenerate');
    setError(null);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}/regenerate-calendar/`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error === 'oauth_required'
          ? 'Google Calendar non connecté — reconnectez-le depuis le tableau de bord.'
          : data.error ?? 'Erreur lors de la génération du lien.');
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
      setActionLoading(null);
    }
  }

  const relativeDay = getRelativeDayLabel(appointment.scheduled_at);
  const dateLabel = `${relativeDay ?? formatDayHeader(appointment.scheduled_at)}, ${formatTimeParis(appointment.scheduled_at)} – ${formatTimeParis(
    new Date(new Date(appointment.scheduled_at).getTime() + appointment.duration * 60_000).toISOString(),
  )}`;

  return (
    <article
      className={
        variant === 'sheet'
          ? 'flex flex-col max-h-[92dvh]'
          : 'flex flex-col'
      }
      aria-label={`Détail du rendez-vous de ${appointment.patient_name}`}
    >
      {/* ── Identité ──────────────────────────────────────────────────────── */}
      <header className="flex items-start gap-3">
        <Avatar name={appointment.patient_name} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-xl font-semibold text-sage-900 truncate">
              {appointment.patient_name}
            </h2>
            <StatusChip status={appointment.status} />
          </div>
          <p className="text-sm text-sage-500 font-sans mt-0.5 truncate">
            {patient
              ? `${patient.isActive ? 'Patient actif' : 'Patient inactif'} · ${patient.sessionCount} séance${patient.sessionCount > 1 ? 's' : ''} au total`
              : `${WB_STATUS_LABELS[appointment.status]} · ${appointment.duration} min`}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la fiche du rendez-vous"
            className="
              inline-flex items-center justify-center w-9 h-9 rounded-full
              text-sage-400 hover:text-sage-700 hover:bg-sage-100
              focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors shrink-0
            "
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </header>

      {/* ── Contact ───────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-xl bg-mint-50 p-3 flex flex-wrap gap-2">
        <a
          href={`mailto:${appointment.patient_email}`}
          className="
            inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-sans
            text-sage-700 shadow-sm hover:text-mint-700 transition-colors
            focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[40px]
          "
        >
          <svg className="w-4 h-4 text-sage-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
            <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
          </svg>
          {appointment.patient_email}
        </a>
        {appointment.patient_phone && (
          <a
            href={`tel:${appointment.patient_phone}`}
            className="
              inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-sans
              text-sage-700 shadow-sm hover:text-mint-700 transition-colors
              focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[40px]
            "
          >
            <svg className="w-4 h-4 text-sage-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
            {appointment.patient_phone}
          </a>
        )}
      </div>

      {/* ── Cartes d'information ──────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <InfoCard label="Date & heure">
          <p className="font-medium">{dateLabel}</p>
          <p className="text-sage-500 text-xs mt-0.5">Durée {appointment.duration} min</p>
        </InfoCard>
        <InfoCard label="Modalité">
          <p className="font-medium">{getModeLabel(appointment.appointment_mode)}</p>
        </InfoCard>
        <InfoCard label="Type de séance">
          <p className="font-medium">{getTypeLabel(appointment.appointment_type)}</p>
        </InfoCard>
        <InfoCard label="Règlement">
          <p className="font-medium">
            {euros(appointment.final_price)} · {paymentLabel(appointment)}
          </p>
        </InfoCard>
      </div>

      {/* ── Lieu / visio ──────────────────────────────────────────────────── */}
      <div className="mt-3 rounded-xl bg-mint-50 p-4 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white shadow-sm text-mint-800 shrink-0">
          {isVideo ? (
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 8.5l2.77-1.85A1 1 0 0118.3 7.5v5a1 1 0 01-1.53.85L14 11.5v-3z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
          )}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold font-sans text-sage-900">
            {isVideo ? 'Téléconsultation' : 'Cabinet'}
          </p>
          <p className="text-xs text-sage-500 font-sans truncate">
            {isVideo
              ? appointment.video_link ?? 'Lien visio non encore généré'
              : [appointment.patient_postal_code, appointment.patient_city].filter(Boolean).join(' ') || 'Séance au cabinet'}
          </p>
        </div>
      </div>

      {/* ── Notes internes ────────────────────────────────────────────────── */}
      <section className="mt-5" aria-label="Notes internes de consultation">
        <h3 className="text-sm font-semibold font-sans text-sage-800 mb-2">
          Notes internes de consultation
        </h3>
        <label htmlFor={`${instanceId}-notes`} className="sr-only">
          Notes internes de consultation
        </label>
        <textarea
          id={`${instanceId}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Notes visibles uniquement par vous…"
          className="
            w-full rounded-xl border border-sage-200 bg-white px-3 py-2 text-sm font-sans
            text-sage-900 placeholder-sage-400 focus:outline-none focus:ring-2 focus:ring-mint-400
            focus:border-transparent transition-colors
          "
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handleSaveNotes}
            disabled={notesSaving || notes === (appointment.therapist_notes ?? '')}
            className="
              inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold font-sans
              rounded-xl bg-sage-900 text-white hover:bg-sage-800 focus:outline-none
              focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors
              disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]
            "
          >
            {notesSaved ? '✓ Enregistrées' : notesSaving ? 'Enregistrement…' : 'Sauvegarder'}
          </button>
        </div>
      </section>

      {/* ── Actions contextuelles ─────────────────────────────────────────── */}
      <section className="mt-4 space-y-2.5" aria-label="Actions sur le rendez-vous">
        {/* Rejoindre la visio */}
        {isVideo && appointment.video_link && isUpcoming(appointment.scheduled_at) && (
          <a
            href={appointment.video_link}
            target="_blank"
            rel="noopener noreferrer"
            className="
              w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
              font-semibold font-sans rounded-xl bg-mint-700 text-white shadow-sm hover:bg-mint-800
              focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
              transition-colors min-h-[44px]
            "
          >
            Rejoindre la visio
          </a>
        )}
        {isVideo && !appointment.video_link && (
          <button
            type="button"
            onClick={handleRegenerateCalendar}
            disabled={actionLoading === 'regenerate'}
            className="
              w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
              font-semibold font-sans rounded-xl bg-mint-700 text-white shadow-sm hover:bg-mint-800
              focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
              transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]
            "
          >
            {actionLoading === 'regenerate' ? 'Génération…' : 'Générer le lien visio'}
          </button>
        )}
        {appointment.status === 'payment_pending' && appointment.stripe_payment_link_url && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                ?.writeText(appointment.stripe_payment_link_url ?? '')
                .then(() => {
                  setNotesSaved(false);
                  setError(null);
                })
                .catch(() => setError('Copie impossible — le lien est dans Stripe.'));
            }}
            className="
              w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
              font-medium font-sans rounded-xl border border-sage-300 text-sage-700
              hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
              transition-colors min-h-[44px]
            "
          >
            Copier le lien de paiement
          </button>
        )}

        {/* Confirmer (pending) — mêmes drapeaux tarifaires que la proposition A */}
        {appointment.status === 'pending' && (
          <div className="rounded-xl border border-sage-200 bg-white p-3 space-y-2.5">
            <label className="flex items-center gap-2.5 text-sm font-sans text-sage-700">
              <input
                type="checkbox"
                checked={confirmFlags.firstSession}
                onChange={(e) => setConfirmFlags((f) => ({ ...f, firstSession: e.target.checked }))}
                className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
              />
              Tarifier comme 1<sup>re</sup> séance
            </label>
            <label className="flex items-center gap-2.5 text-sm font-sans text-sage-700">
              <input
                type="checkbox"
                checked={confirmFlags.solidarity}
                onChange={(e) => setConfirmFlags((f) => ({ ...f, solidarity: e.target.checked }))}
                className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
              />
              Tarif solidaire
            </label>
            <button
              type="button"
              onClick={() =>
                callPatch(
                  {
                    action: 'confirm',
                    override_first_session: confirmFlags.firstSession,
                    is_solidarity: confirmFlags.solidarity,
                  },
                  'confirm',
                )
              }
              disabled={actionLoading === 'confirm'}
              className="
                w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
                font-semibold font-sans rounded-xl bg-sage-900 text-white hover:bg-sage-800
                focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
                transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]
              "
            >
              {actionLoading === 'confirm' ? 'Confirmation…' : 'Confirmer le rendez-vous'}
            </button>
          </div>
        )}

        {/* Report / annulation / refus */}
        <div className="flex flex-wrap gap-2.5">
          {canReschedule && (
            <button
              type="button"
              onClick={() => setOpenPanel(openPanel === 'reschedule' ? null : 'reschedule')}
              aria-expanded={openPanel === 'reschedule'}
              className="
                flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
                font-medium font-sans rounded-xl border border-sage-300 text-sage-700
                hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
                transition-colors min-h-[44px]
              "
            >
              Reporter
            </button>
          )}
          {appointment.status === 'rescheduled' && (
            <button
              type="button"
              onClick={() => callPatch({ action: 'cancel_reschedule' }, 'cancel_reschedule')}
              disabled={actionLoading === 'cancel_reschedule'}
              className="
                flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
                font-medium font-sans rounded-xl border border-sage-300 text-sage-700
                hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
                transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]
              "
            >
              Annuler le report
            </button>
          )}
          {(appointment.status === 'pending' || appointment.status === 'payment_pending') && (
            <button
              type="button"
              onClick={() => setOpenPanel(openPanel === 'decline' ? null : 'decline')}
              aria-expanded={openPanel === 'decline'}
              className="
                flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
                font-medium font-sans rounded-xl border border-red-200 text-red-700
                hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300
                transition-colors min-h-[44px]
              "
            >
              Refuser
            </button>
          )}
          {canCancel && appointment.status !== 'pending' && (
            <button
              type="button"
              onClick={() => setOpenPanel(openPanel === 'cancel' ? null : 'cancel')}
              aria-expanded={openPanel === 'cancel'}
              className="
                flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
                font-medium font-sans rounded-xl border border-red-200 text-red-700
                hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300
                transition-colors min-h-[44px]
              "
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            disabled
            title="Rappels automatiques — à construire"
            className="
              flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
              font-medium font-sans rounded-xl border border-sage-200 text-sage-400
              cursor-not-allowed min-h-[44px]
            "
          >
            Rappel SMS / Mail
          </button>
        </div>

        {/* Panneau reprogrammation */}
        {openPanel === 'reschedule' && (
          <div className="rounded-xl border border-sage-200 bg-white p-3 space-y-2.5">
            <label htmlFor={`${instanceId}-reschedule`} className="block text-sm font-medium font-sans text-sage-700">
              Nouveau créneau
            </label>
            {appointment.status === 'payment_pending' && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-sans text-amber-800">
                <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                Séance impayée : le lien de paiement du créneau d'origine sera expiré, un nouveau
                sera envoyé lorsque le patient acceptera la proposition.
              </p>
            )}
            <input
              id={`${instanceId}-reschedule`}
              type="datetime-local"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="
                w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900
                focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]
              "
            />
            <label htmlFor={`${instanceId}-reschedule-msg`} className="sr-only">
              Message pour le patient (optionnel)
            </label>
            <input
              id={`${instanceId}-reschedule-msg`}
              type="text"
              value={actionMessage}
              onChange={(e) => setActionMessage(e.target.value)}
              placeholder="Message pour le patient (optionnel)"
              className="
                w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900
                placeholder-sage-400 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]
              "
            />
            <button
              type="button"
              disabled={!rescheduleDate || actionLoading === 'reschedule'}
              onClick={() =>
                callPatch(
                  {
                    action: isDirectReschedule ? 'reschedule_paid' : 'reschedule',
                    rescheduled_to: new Date(rescheduleDate).toISOString(),
                    ...(actionMessage ? { therapist_notes: actionMessage } : {}),
                  },
                  'reschedule',
                )
              }
              className="
                w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold
                font-sans rounded-xl bg-sage-900 text-white hover:bg-sage-800 focus:outline-none
                focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors
                disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]
              "
            >
              {actionLoading === 'reschedule' ? 'Reprogrammation…' : 'Valider le nouveau créneau'}
            </button>
          </div>
        )}

        {/* Panneau refus / annulation (message optionnel) */}
        {(openPanel === 'decline' || openPanel === 'cancel') && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2.5">
            <label htmlFor={`${instanceId}-action-msg`} className="block text-sm font-medium font-sans text-red-800">
              {openPanel === 'decline' ? 'Refuser la demande' : 'Annuler le rendez-vous'}
            </label>
            <input
              id={`${instanceId}-action-msg`}
              type="text"
              value={actionMessage}
              onChange={(e) => setActionMessage(e.target.value)}
              placeholder="Message pour le patient (optionnel)"
              className="
                w-full rounded-xl border border-red-200 px-3 py-2 text-sm font-sans text-sage-900
                placeholder-sage-400 focus:outline-none focus:ring-2 focus:ring-red-300 min-h-[44px]
              "
            />
            <button
              type="button"
              disabled={actionLoading !== null}
              onClick={() =>
                callPatch(
                  {
                    action: openPanel,
                    ...(actionMessage ? { therapist_notes: actionMessage } : {}),
                  },
                  openPanel,
                )
              }
              className="
                w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold
                font-sans rounded-xl bg-red-700 text-white hover:bg-red-800 focus:outline-none
                focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors
                disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]
              "
            >
              {actionLoading === openPanel
                ? 'Traitement…'
                : openPanel === 'decline'
                  ? 'Confirmer le refus'
                  : 'Confirmer l’annulation'}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-sans">
            {error}
          </p>
        )}
      </section>
    </article>
  );
}
