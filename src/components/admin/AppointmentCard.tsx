/**
 * AppointmentCard — React island pour la gestion d'un rendez-vous (back-office)
 *
 * Actions disponibles selon le statut :
 *   pending / rescheduled → Confirmer | Refuser | Reporter
 *   payment_pending       → Voir lien paiement | Refuser
 *   confirmed             → Envoyer rappel avis
 *   payment_received      → Envoyer rappel avis
 *   declined / cancelled  → lecture seule
 */

import { useState, useMemo } from "react";
import type { Appointment, AppointmentStatus } from "../../types/appointment";
import { getTypeLabel, getModeLabel, calculatePrice, SOLIDARITY_DISCOUNT } from "../../lib/pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppointmentCardProps {
  appointment: Appointment;
}

type ModalType = "confirm" | "decline" | "reschedule" | null;

// ---------------------------------------------------------------------------
// Constantes statut
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmé",
  declined: "Refusé",
  rescheduled: "Reporté",
  payment_pending: "Paiement en attente",
  payment_received: "Paiement reçu",
  cancelled: "Annulé",
};

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  rescheduled: "bg-blue-100 text-blue-800",
  payment_pending: "bg-yellow-100 text-yellow-800",
  payment_received: "bg-teal-100 text-teal-800",
  cancelled: "bg-gray-100 text-gray-600",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

function formatPrice(centimes: number): string {
  return `${Math.round(centimes / 100)}€`;
}

// ---------------------------------------------------------------------------
// Sous-composant Modal
// ---------------------------------------------------------------------------

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3
            id="modal-title"
            className="font-serif text-lg font-semibold text-sage-800"
          >
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-sage-400 hover:text-sage-600 transition-colors"
            aria-label="Fermer"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function AppointmentCard({ appointment }: AppointmentCardProps) {
  const [modal, setModal] = useState<ModalType>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // État notes
  const [notes, setNotes] = useState(appointment.therapist_notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // États formulaires modaux
  const [videoLink, setVideoLink] = useState(appointment.video_link ?? "");
  const [declineMessage, setDeclineMessage] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleMessage, setRescheduleMessage] = useState("");

  // États tarification (modale Confirmer)
  const [overrideFirstSession, setOverrideFirstSession] = useState(appointment.is_first_session);
  const [isSolidarity, setIsSolidarity] = useState(false);

  const livePrice = useMemo(
    () => calculatePrice(appointment.appointment_type, appointment.duration, overrideFirstSession, isSolidarity),
    [appointment.appointment_type, appointment.duration, overrideFirstSession, isSolidarity],
  );

  const { status } = appointment;
  const isReadOnly = status === "declined" || status === "cancelled";

  // ── PATCH helper ─────────────────────────────────────────────────────────

  async function callPatch(body: Record<string, unknown>): Promise<boolean> {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      window.location.reload();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Erreur inconnue");
      setActionLoading(false);
      return false;
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleConfirm() {
    await callPatch({
      action: "confirm",
      override_first_session: overrideFirstSession,
      is_solidarity: isSolidarity,
      ...(videoLink ? { video_link: videoLink } : {}),
    });
  }

  async function handleDecline() {
    await callPatch({
      action: "decline",
      ...(declineMessage ? { therapist_notes: declineMessage } : {}),
    });
  }

  async function handleReschedule() {
    if (!rescheduleDate) {
      setActionError("Veuillez sélectionner un nouveau créneau.");
      return;
    }
    await callPatch({
      action: "reschedule",
      rescheduled_to: new Date(rescheduleDate).toISOString(),
      ...(rescheduleMessage ? { therapist_notes: rescheduleMessage } : {}),
    });
  }

  async function handleSendReview() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/send-review-email/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ appointmentId: appointment.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      alert("Email de rappel avis envoyé avec succès.");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Erreur inconnue");
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
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "save_notes", therapist_notes: notes }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Erreur HTTP ${res.status}`);
      }
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setNotesSaving(false);
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
            {" · "}
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
          <span className="block text-xs text-sage-400 mb-0.5">Date prévue</span>
          <span className="font-medium text-sage-800">
            {formatDate(appointment.scheduled_at)}
          </span>
        </div>
        <div>
          <span className="block text-xs text-sage-400 mb-0.5">Tarif</span>
          <span className="font-medium text-sage-800">
            {formatPrice(appointment.final_price)}
            {appointment.discount > 0 && (
              <span className="text-mint-600 text-xs ml-1">
                (–{formatPrice(appointment.discount)})
              </span>
            )}
          </span>
        </div>
        {appointment.is_first_session && (
          <div>
            <span className="block text-xs text-sage-400 mb-0.5">Séance</span>
            <span className="font-medium text-mint-600 text-xs">
              1ère séance
            </span>
          </div>
        )}
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
        {appointment.video_link && (
          <div className="col-span-2 sm:col-span-3">
            <span className="block text-xs text-sage-400 mb-0.5">
              Lien visio
            </span>
            <a
              href={appointment.video_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-mint-600 hover:text-mint-700 text-sm font-medium break-all"
            >
              {appointment.video_link}
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

      {/* Boutons d'action */}
      {!isReadOnly && (
        <div className="flex flex-wrap gap-2 mb-4">
          {(status === "pending" || status === "rescheduled") && (
            <>
              <button
                onClick={() => { setModal("confirm"); setActionError(null); }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 active:bg-mint-800 focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Confirmer
              </button>
              <button
                onClick={() => { setModal("decline"); setActionError(null); }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Refuser
              </button>
              {status === "pending" && (
                <button
                  onClick={() => { setModal("reschedule"); setActionError(null); }}
                  disabled={actionLoading}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
                >
                  Reporter
                </button>
              )}
            </>
          )}

          {status === "payment_pending" && (
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
                onClick={() => { setModal("decline"); setActionError(null); }}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-red-300 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
              >
                Refuser
              </button>
            </>
          )}

          {(status === "confirmed" || status === "payment_received") && (
            <button
              onClick={handleSendReview}
              disabled={actionLoading}
              className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
            >
              {actionLoading ? "Envoi…" : "Envoyer rappel avis"}
            </button>
          )}
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
            {notesSaving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
          {notesSaved && (
            <span className="text-xs text-green-600 font-sans">✓ Sauvegardé</span>
          )}
        </div>
      </div>

      {/* ── Modal : Confirmer ─────────────────────────────────────────────── */}
      {modal === "confirm" && (
        <Modal title="Confirmer le rendez-vous" onClose={() => setModal(null)}>
          {/* ── Tarification ───────────────────────────────────────── */}
          <div className="mb-5 rounded-xl border border-sage-200 bg-sage-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-sage-500 font-sans">
              Tarification
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={overrideFirstSession && !isSolidarity}
                  onChange={e => {
                    if (e.target.checked) { setOverrideFirstSession(true); setIsSolidarity(false); }
                    else setOverrideFirstSession(false);
                  }}
                  className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                />
                <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
                  Remise nouveau client <span className="text-sage-400">(−15€ première séance)</span>
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isSolidarity}
                  onChange={e => {
                    if (e.target.checked) { setIsSolidarity(true); setOverrideFirstSession(false); }
                    else setIsSolidarity(false);
                  }}
                  className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                />
                <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
                  Tarif solidaire <span className="text-sage-400">(−{SOLIDARITY_DISCOUNT}€ · RSA / ASS / Étudiant)</span>
                </span>
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-sage-200 pt-3">
              <span className="text-xs text-sage-500 font-sans">
                Base {livePrice.basePrice}€
                {livePrice.discount > 0 && <span className="text-mint-700"> · remise −{livePrice.discount}€</span>}
              </span>
              <span className="text-base font-semibold text-sage-900 font-sans">
                À régler : {livePrice.finalPrice}€
              </span>
            </div>
          </div>
          {appointment.appointment_mode === "video" && (
            <div className="mb-5">
              <label
                htmlFor="video-link-input"
                className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
              >
                Lien visio Google Meet{" "}
                <span className="text-sage-400 font-normal">(optionnel — auto-généré si vide)</span>
              </label>
              <input
                id="video-link-input"
                type="url"
                value={videoLink}
                onChange={(e) => setVideoLink(e.target.value)}
                placeholder="Laissez vide pour auto-génération Google Meet"
                className="w-full px-4 py-2.5 rounded-xl border border-sage-200 bg-sage-50 text-sage-900 placeholder-sage-400 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent transition-colors"
              />
            </div>
          )}
          {actionError && (
            <p className="mb-4 text-sm text-red-700 font-sans">{actionError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setModal(null)}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              Annuler
            </button>
            <button
              onClick={handleConfirm}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              {actionLoading ? "En cours…" : "Confirmer"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal : Refuser ───────────────────────────────────────────────── */}
      {modal === "decline" && (
        <Modal title="Refuser le rendez-vous" onClose={() => setModal(null)}>
          <p className="text-sm text-sage-600 font-sans mb-4">
            Le patient recevra un email l'informant du refus.
          </p>
          <div className="mb-5">
            <label
              htmlFor="decline-msg-input"
              className="block text-sm font-medium text-sage-700 font-sans mb-1.5"
            >
              Message pour le patient{" "}
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
              onClick={() => setModal(null)}
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
              {actionLoading ? "En cours…" : "Refuser"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal : Reporter ──────────────────────────────────────────────── */}
      {modal === "reschedule" && (
        <Modal title="Reporter le rendez-vous" onClose={() => setModal(null)}>
          <p className="text-sm text-sage-600 font-sans mb-4">
            Le patient recevra un email avec le nouveau créneau proposé.
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
              Message pour le patient{" "}
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
              onClick={() => setModal(null)}
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
              {actionLoading ? "En cours…" : "Reporter"}
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
