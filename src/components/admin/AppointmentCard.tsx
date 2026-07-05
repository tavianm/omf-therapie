/**
 * AppointmentCard — React island pour la gestion d'un rendez-vous (back-office)
 *
 * Actions disponibles selon le statut (un seul conteneur, hiérarchie principale→dangereux) :
 *   pending          → Confirmer · Reporter · Refuser
 *   payment_pending  → Voir lien paiement · Refuser
 *   confirmed/payé   → Envoyer rappel avis · Reporter · Annuler (+ avertissement avoir si payé)
 *   rescheduled      → Annuler la proposition
 *   declined / cancelled → lecture seule
 *
 * Refuser (demande non payée) et Annuler (RDV confirmé/payé) sont mutuellement
 * exclusifs par statut : ils n'apparaissent jamais simultanément.
 * Annuler / Reporter ne s'affichent que dans la fenêtre d'éligibilité (veille incluse).
 */

import { useState } from 'react';
import { getModeLabel, getTypeLabel } from '../../lib/pricing';
import type { Appointment, AppointmentStatus } from '../../types/appointment';
import { isCancellableByTherapist } from '../../utils/date';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppointmentCardProps {
  appointment: Appointment;
}

type ModalType = 'confirm' | 'decline' | 'cancel' | 'reschedule' | 'reschedule_paid' | null;

// ---------------------------------------------------------------------------
// Constantes statut
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'En attente',
  confirmed: 'Confirmé',
  declined: 'Refusé',
  rescheduled: 'Reporté',
  payment_pending: 'Paiement en attente',
  payment_received: 'Paiement reçu',
  cancelled: 'Annulé',
};

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  rescheduled: 'bg-blue-100 text-blue-800',
  payment_pending: 'bg-yellow-100 text-yellow-800',
  payment_received: 'bg-teal-100 text-teal-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

function formatPrice(centimes: number): string {
  return `${Math.round(centimes / 100)}€`;
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function AppointmentCard({ appointment }: AppointmentCardProps) {
  const [modal, setModal] = useState<ModalType>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewSent, setReviewSent] = useState(false);

  // État notes
  const [notes, setNotes] = useState(appointment.therapist_notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // États formulaires modaux
  const [videoLink, setVideoLink] = useState(appointment.video_link ?? '');
  const [declineMessage, setDeclineMessage] = useState('');
  const [cancelMessage, setCancelMessage] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleMessage, setRescheduleMessage] = useState('');

  // États régénération Calendar / Meet
  const [calendarEventId, setCalendarEventId] = useState(
    appointment.google_calendar_event_id ?? null,
  );
  const [meetLink, setMeetLink] = useState(appointment.video_link ?? null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenSuccess, setRegenSuccess] = useState(false);

  const { status } = appointment;
  const isReadOnly = status === 'declined' || status === 'cancelled';
  // Éligibilité à l'annulation / report (fenêtre veille incluse, Europe/Paris).
  const isCancellable = isCancellableByTherapist(appointment);
  // Un RDV déjà arrimé (confirmed ∨ payment_received, tous modes) se reporte par
  // move direct admin : la thérapeute déplace le créneau, paiement/avoir conservé,
  // patient notifié. Pas de re-validation, pas de proposition.
  const isDirectReschedule =
    status === 'confirmed' || status === 'payment_received';

  // ── PATCH helper ─────────────────────────────────────────────────────────

  async function callPatch(body: Record<string, unknown>): Promise<boolean> {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      window.location.reload();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erreur inconnue');
      setActionLoading(false);
      return false;
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleConfirm(
    overrideFirstSession: boolean,
    isSolidarity: boolean,
  ) {
    await callPatch({
      action: 'confirm',
      override_first_session: overrideFirstSession,
      is_solidarity: isSolidarity,
      ...(videoLink ? { video_link: videoLink } : {}),
    });
  }

  async function handleDecline() {
    await callPatch({
      action: 'decline',
      ...(declineMessage ? { therapist_notes: declineMessage } : {}),
    });
  }

  async function handleReschedule() {
    if (!rescheduleDate) {
      setActionError('Veuillez sélectionner un nouveau créneau.');
      return;
    }
    // RDV déjà arrimé (confirmed/payment_received) : move direct admin.
    // Sinon (pending/payment_pending) : flow de proposition au patient.
    const action = isDirectReschedule ? 'reschedule_paid' : 'reschedule';
    await callPatch({
      action,
      rescheduled_to: new Date(rescheduleDate).toISOString(),
      ...(rescheduleMessage ? { therapist_notes: rescheduleMessage } : {}),
    });
  }

  async function handleCancel() {
    await callPatch({
      action: 'cancel',
      ...(cancelMessage ? { therapist_notes: cancelMessage } : {}),
    });
  }

  async function handleSendReview() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch('/api/send-review-email/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ appointmentId: appointment.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      setReviewSent(true);
      setTimeout(() => setReviewSent(false), 4000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    setNotesSaved(false);
    setActionError(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'save_notes', therapist_notes: notes }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setNotesSaving(false);
    }
  }

  async function handleRegenerateCalendar() {
    setIsRegenerating(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/appointments/${appointment.id}/regenerate-calendar`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      const data = (await res.json()) as {
        google_calendar_event_id?: string;
        video_link?: string;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 503 || data.error === 'oauth_required') {
          setActionError(
            'Google Calendar non connecté — reconnectez via le tableau de bord',
          );
        } else if (res.status === 403 || data.error === 'permission_denied') {
          setActionError('Permissions insuffisantes sur Google Calendar');
        } else if (res.status === 429 || data.error === 'quota_exceeded') {
          setActionError('Quota Google Calendar dépassé, réessayez plus tard');
        } else {
          setActionError(data.error ?? 'Erreur lors de la régénération');
        }
        return;
      }
      if (data.google_calendar_event_id)
        setCalendarEventId(data.google_calendar_event_id);
      if (data.video_link) setMeetLink(data.video_link);
      setRegenSuccess(true);
      setTimeout(() => setRegenSuccess(false), 3000);
    } catch {
      setActionError('Erreur réseau');
    } finally {
      setIsRegenerating(false);
    }
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <article className="bg-white rounded-xl border border-sage-100 shadow-sm p-5 sm:p-6">
      {/* En-tête : patient + badge statut */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-serif text-lg font-semibold text-sage-900 leading-snug">
            {appointment.patient_name}
          </h3>
          <p className="text-sm text-sage-500 mt-0.5">
            <a
              href={`mailto:${appointment.patient_email}`}
              className="hover:text-mint-600 transition-colors"
            >
              {appointment.patient_email}
            </a>
            {' · '}
            <a
              href={`tel:${appointment.patient_phone}`}
              className="hover:text-mint-600 transition-colors"
            >
              {appointment.patient_phone}
            </a>
          </p>
          {(appointment.patient_city || appointment.patient_postal_code) && (
            <p className="text-xs text-sage-400 mt-0.5">
              {appointment.patient_postal_code} {appointment.patient_city}
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium font-sans ${STATUS_BADGE[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      {/* Détails de la séance */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mb-4 text-sm font-sans">
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">Type</span>
          <span className="font-medium text-sage-800">
            {getTypeLabel(appointment.appointment_type)}
          </span>
        </div>
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">Mode</span>
          <span className="font-medium text-sage-800">
            {getModeLabel(appointment.appointment_mode)}
          </span>
        </div>
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">Durée</span>
          <span className="font-medium text-sage-800">
            {appointment.duration} min
          </span>
        </div>
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">
            Date prévue
          </span>
          <span className="font-medium text-sage-800">
            {formatDate(appointment.scheduled_at)}
          </span>
        </div>
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">Tarif</span>
          <span className="font-medium text-sage-800">
            {formatPrice(appointment.final_price)}
          </span>
          <p className="text-xs text-sage-500 mt-0.5">
            Base {formatPrice(appointment.base_price)}
            {appointment.discount > 0 && (
              <span className="text-mint-700">
                {' '}
                · remise −{formatPrice(appointment.discount)}
              </span>
            )}
          </p>
        </div>
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">
            Remise nouveau client
          </span>
          <span
            className={`font-medium text-xs ${appointment.is_first_session ? 'text-mint-600' : 'text-sage-700'}`}
          >
            {appointment.is_first_session ? 'Oui (1ère séance)' : 'Non'}
          </span>
        </div>
        {appointment.rescheduled_to && (
          <div className="col-span-2">
            <span className="block text-xs text-sage-400 mb-0.5">
              Reporté au
            </span>
            <span className="font-medium text-blue-700">
              {formatDate(appointment.rescheduled_to)}
            </span>
          </div>
        )}
        {meetLink && (
          <div className="col-span-2 sm:col-span-3">
            <span className="block text-xs text-sage-400 mb-0.5">
              Lien visio
            </span>
            <a
              href={meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-mint-600 hover:text-mint-700 text-sm font-medium break-all"
            >
              {meetLink}
            </a>
          </div>
        )}
        {appointment.stripe_payment_link_url && (
          <div className="col-span-2 sm:col-span-3">
            <span className="block text-xs text-sage-400 mb-0.5">
              Lien Stripe
            </span>
            <a
              href={appointment.stripe_payment_link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-mint-600 hover:text-mint-700 text-sm font-medium break-all"
            >
              {appointment.stripe_payment_link_url}
            </a>
          </div>
        )}
      </div>

      {/* Motif patient */}
      {appointment.patient_reason && (
        <details className="mb-4">
          <summary className="text-xs text-sage-400 cursor-pointer hover:text-sage-600 select-none font-sans">
            Motif de consultation
          </summary>
          <p className="mt-2 text-sm text-sage-700 bg-sage-50 rounded-lg p-3 font-sans leading-relaxed">
            {appointment.patient_reason}
          </p>
        </details>
      )}

      {/* Boutons d'action — un seul conteneur cohérent par statut.
          Hiérarchie : action principale (plein) → secondaires (contour sage) →
          destructive (contour rouge, à droite). Refuser et Annuler sont
          mutuellement exclusifs par statut (jamais simultanés). */}
      {!isReadOnly && (
        <div className="flex flex-wrap gap-2 mb-4">
          {status === 'pending' && (
            <>
              <button
                onClick={() => {
                  setModal('confirm');
                  setActionError(null);
                }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 active:bg-mint-800 focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Confirmer
              </button>
              <button
                onClick={() => {
                  setModal('reschedule');
                  setActionError(null);
                }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Reporter
              </button>
              <button
                onClick={() => {
                  setModal('decline');
                  setActionError(null);
                }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Refuser
              </button>
            </>
          )}

          {status === 'rescheduled' &&
            appointment.rescheduled_to &&
            appointment.rescheduled_to > new Date().toISOString() && (
              <button
                onClick={() => callPatch({ action: 'cancel_reschedule' })}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                {actionLoading ? 'En cours…' : 'Annuler la proposition'}
              </button>
            )}

          {status === 'payment_pending' && (
            <>
              {appointment.stripe_payment_link_url ? (
                <a
                  href={appointment.stripe_payment_link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 transition-colors min-h-[40px]"
                >
                  Voir lien paiement
                </a>
              ) : (
                <span className="inline-flex items-center px-4 py-2 text-sm text-sage-500 font-sans">
                  En attente de paiement — lien envoyé par email
                </span>
              )}
              <button
                onClick={() => {
                  setModal('decline');
                  setActionError(null);
                }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Refuser
              </button>
            </>
          )}

          {(status === 'confirmed' || status === 'payment_received') && (
            <>
              <button
                onClick={handleSendReview}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                {actionLoading ? 'Envoi…' : 'Envoyer rappel avis'}
              </button>
              {reviewSent && (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1 text-sm text-green-700 font-sans"
                >
                  <svg
                    className="w-4 h-4 flex-shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Email envoyé
                </span>
              )}
              {/* Reporter un RDV confirmé/payé : move direct admin (paiement conservé pour vidéo payé). */}
              {isCancellable && (
                <button
                  onClick={() => {
                    setModal('reschedule');
                    setActionError(null);
                  }}
                  disabled={actionLoading}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
                >
                  Reporter
                </button>
              )}
              {/* Annuler un RDV confirmé/payé (exclusif avec Refuser qui n'apparaît qu'en pending/payment_pending). */}
              {isCancellable && (
                <button
                  onClick={() => {
                    setModal('cancel');
                    setActionError(null);
                  }}
                  disabled={actionLoading}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
                >
                  Annuler
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Avertissement avoir — attaché à l'action Annuler d'un RDV payé. */}
      {isCancellable &&
        status === 'payment_received' &&
        appointment.final_price - appointment.credit_applied > 0 && (
          <p className="mb-4 text-xs text-amber-700 font-sans">
            L'annulation émettra un avoir de{' '}
            {Math.round((appointment.final_price - appointment.credit_applied) / 100)}€
            au profit du patient.
          </p>
        )}

      {/* Bouton régénération Calendar / Meet (vidéo uniquement, si event ou lien manquant) */}
      {appointment.appointment_mode === 'video' &&
        (!meetLink || !calendarEventId) &&
        !isReadOnly && (
          <div className="flex flex-wrap gap-2 mb-4">
            {(() => {
              const regenLabel =
                !calendarEventId && !meetLink
                  ? 'Régénérer Calendar et Meet'
                  : !calendarEventId
                    ? 'Régénérer Calendar'
                    : 'Régénérer lien Meet';
              return (
                <>
                  <button
                    onClick={handleRegenerateCalendar}
                    disabled={isRegenerating}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[36px]"
                    title={regenLabel}
                    aria-label={
                      isRegenerating ? 'Régénération en cours…' : regenLabel
                    }
                  >
                    {isRegenerating ? (
                      <span
                        className="inline-block w-3.5 h-3.5 border-2 border-sage-400 border-t-transparent rounded-full animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                    )}
                    {isRegenerating ? 'Régénération…' : regenLabel}
                  </button>
                  {regenSuccess && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="inline-flex items-center gap-1 text-sm text-green-700 font-sans"
                    >
                      <svg
                        className="w-4 h-4 flex-shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Régénéré
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        )}

      {/* Message d'erreur */}
      {actionError && (
        <div
          role="alert"
          className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-sans"
        >
          {actionError}
        </div>
      )}

      {/* Notes thérapeute */}
      <div className="pt-4 border-t border-sage-100">
        <label
          htmlFor={`notes-${appointment.id}`}
          className="block text-xs font-medium text-sage-400 mb-1.5 font-sans"
        >
          Notes thérapeute (internes)
        </label>
        <textarea
          id={`notes-${appointment.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 text-sm text-sage-800 border border-sage-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent resize-none font-sans placeholder-sage-300 transition-colors"
          placeholder="Notes internes…"
        />
        <div className="flex items-center gap-3 mt-1.5">
          <button
            onClick={handleSaveNotes}
            disabled={notesSaving}
            className="text-xs font-medium font-sans text-mint-600 hover:text-mint-700 transition-colors disabled:opacity-60"
          >
            {notesSaving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
          {notesSaved && (
            <span
              role="status"
              aria-live="polite"
              className="text-xs text-green-600 font-sans"
            >
              ✓ Sauvegardé
            </span>
          )}
        </div>
      </div>

      {/* ── Modal : Confirmer ─────────────────────────────────────────────── */}
      {modal === 'confirm' && (
        <ConfirmModal
          appointment={appointment}
          videoLink={videoLink}
          setVideoLink={setVideoLink}
          actionLoading={actionLoading}
          actionError={actionError}
          onClose={() => setModal(null)}
          onConfirm={handleConfirm}
        />
      )}

      {/* ── Modal : Refuser ───────────────────────────────────────────────── */}
      {modal === 'decline' && (
        <Modal
          title="Refuser le rendez-vous"
          onClose={() => {
            if (
              declineMessage.trim() &&
              !window.confirm('Abandonner ? Votre message sera perdu.')
            )
              return;
            setModal(null);
          }}
        >
          <p className="text-sm text-sage-600 font-sans mb-4">
            Le patient recevra un email l'informant du refus.
          </p>
          <div className="mb-5">
            <label
              htmlFor="decline-msg-input"
              className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
            >
              Message pour le patient{' '}
              <span className="text-sage-400 font-normal">(optionnel)</span>
            </label>
            <textarea
              id="decline-msg-input"
              value={declineMessage}
              onChange={(e) => setDeclineMessage(e.target.value)}
              rows={3}
              placeholder="Expliquez la raison du refus…"
              className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 placeholder-sage-400 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent resize-none transition-colors"
            />
          </div>
          {actionError && (
            <p className="mb-4 text-sm text-red-700 font-sans">{actionError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                if (
                  declineMessage.trim() &&
                  !window.confirm('Abandonner ? Votre message sera perdu.')
                )
                  return;
                setModal(null);
              }}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              Annuler
            </button>
            <button
              onClick={handleDecline}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              {actionLoading ? 'En cours…' : 'Refuser'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal : Annuler ───────────────────────────────────────────────── */}
      {modal === 'cancel' && (
        <Modal
          title="Annuler le rendez-vous"
          onClose={() => {
            if (
              cancelMessage.trim() &&
              !window.confirm('Abandonner ? Votre message sera perdu.')
            )
              return;
            setModal(null);
          }}
        >
          <p className="text-sm text-sage-600 font-sans mb-4">
            Le patient recevra un email d'annulation.
            {appointment.status === 'payment_received' && appointment.final_price - appointment.credit_applied > 0 && (
              <>
                {' '}
                <span className="text-amber-700 font-medium">
                  Un avoir de {Math.round((appointment.final_price - appointment.credit_applied) / 100)}€ (montant payé) sera émis au profit du patient.
                </span>
              </>
            )}
          </p>
          <div className="mb-5">
            <label
              htmlFor="cancel-msg-input"
              className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
            >
              Message pour le patient{' '}
              <span className="text-sage-400 font-normal">(optionnel)</span>
            </label>
            <textarea
              id="cancel-msg-input"
              value={cancelMessage}
              onChange={(e) => setCancelMessage(e.target.value)}
              rows={3}
              placeholder="Expliquez la raison de l'annulation…"
              className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 placeholder-sage-400 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent resize-none transition-colors"
            />
          </div>
          {actionError && (
            <p className="mb-4 text-sm text-red-700 font-sans">{actionError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                if (
                  cancelMessage.trim() &&
                  !window.confirm('Abandonner ? Votre message sera perdu.')
                )
                  return;
                setModal(null);
              }}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              Fermer
            </button>
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              {actionLoading ? 'En cours…' : 'Annuler le rendez-vous'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal : Reporter ──────────────────────────────────────────────── */}
      {modal === 'reschedule' && (
        <Modal
          title="Reporter le rendez-vous"
          onClose={() => {
            if (
              (rescheduleDate || rescheduleMessage.trim()) &&
              !window.confirm(
                'Abandonner ? Les données saisies seront perdues.',
              )
            )
              return;
            setModal(null);
          }}
        >
          <p className="text-sm text-sage-600 font-sans mb-4">
            {isDirectReschedule
              ? 'Le rendez-vous sera déplacé vers le nouveau créneau. Le paiement déjà effectué (ou l\'avoir) est conservé — aucun nouveau paiement ne sera demandé. Le patient sera notifié.'
              : 'Le patient recevra un email avec le nouveau créneau proposé.'}
          </p>
          <div className="mb-4">
            <label
              htmlFor="reschedule-date-input"
              className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
            >
              Nouveau créneau <span className="text-red-500">*</span>
            </label>
            <input
              id="reschedule-date-input"
              type="datetime-local"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent transition-colors"
            />
          </div>
          <div className="mb-5">
            <label
              htmlFor="reschedule-msg-input"
              className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
            >
              Message pour le patient{' '}
              <span className="text-sage-400 font-normal">(optionnel)</span>
            </label>
            <textarea
              id="reschedule-msg-input"
              value={rescheduleMessage}
              onChange={(e) => setRescheduleMessage(e.target.value)}
              rows={2}
              placeholder="Expliquez le report…"
              className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 placeholder-sage-400 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent resize-none transition-colors"
            />
          </div>
          {actionError && (
            <p className="mb-4 text-sm text-red-700 font-sans">{actionError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                if (
                  (rescheduleDate || rescheduleMessage.trim()) &&
                  !window.confirm(
                    'Abandonner ? Les données saisies seront perdues.',
                  )
                )
                  return;
                setModal(null);
              }}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              Annuler
            </button>
            <button
              onClick={handleReschedule}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              {actionLoading ? 'En cours…' : 'Reporter'}
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
