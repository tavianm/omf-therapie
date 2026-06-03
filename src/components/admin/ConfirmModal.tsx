// ---------------------------------------------------------------------------
// Sous-composant ConfirmModal (isolé de AppointmentCard)
// ---------------------------------------------------------------------------

import { calculatePrice, SOLIDARITY_DISCOUNT } from '@/lib/pricing';
import type { Appointment } from '@/types/appointment';
import { useMemo, useState } from 'react';
import { Modal } from './Modal';

interface ConfirmModalProps {
  appointment: Appointment;
  videoLink: string;
  setVideoLink: (v: string) => void;
  actionLoading: boolean;
  actionError: string | null;
  onClose: () => void;
  onConfirm: (overrideFirstSession: boolean, isSolidarity: boolean) => void;
}

export function ConfirmModal({
  appointment,
  videoLink,
  setVideoLink,
  actionLoading,
  actionError,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  // ✅ Ces états n'existent que quand la modale est montée
  const [overrideFirstSession, setOverrideFirstSession] = useState(
    appointment.is_first_session,
  );
  const [isSolidarity, setIsSolidarity] = useState(false);

  // ✅ useMemo ne tourne que dans ce composant, pas pour chaque card
  const livePrice = useMemo(
    () =>
      calculatePrice(
        appointment.appointment_type,
        appointment.duration,
        overrideFirstSession,
        isSolidarity,
      ),
    [appointment.appointment_type, appointment.duration, overrideFirstSession, isSolidarity],
  );

  return (
    <Modal title="Confirmer le rendez-vous" onClose={onClose}>
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
              onChange={(e) => {
                if (e.target.checked) {
                  setOverrideFirstSession(true);
                  setIsSolidarity(false);
                } else {
                  setOverrideFirstSession(false);
                }
              }}
              className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
            />
            <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
              Remise nouveau client{" "}
              <span className="text-sage-400">(−15€ première séance)</span>
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={isSolidarity}
              onChange={(e) => {
                if (e.target.checked) {
                  setIsSolidarity(true);
                  setOverrideFirstSession(false);
                } else {
                  setIsSolidarity(false);
                }
              }}
              className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
            />
            <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
              Tarif solidaire{" "}
              <span className="text-sage-400">
                (−{SOLIDARITY_DISCOUNT}€ · RSA / ASS / Étudiant)
              </span>
            </span>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-sage-200 pt-3">
          <span className="text-xs text-sage-500 font-sans">
            Base {livePrice.basePrice}€
            {livePrice.discount > 0 && (
              <span className="text-mint-700">
                {" "}
                · remise −{livePrice.discount}€
              </span>
            )}
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
            <span className="text-sage-400 font-normal">
              (optionnel — auto-généré si vide)
            </span>
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
          onClick={onClose}
          disabled={actionLoading}
          className="px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 transition-colors disabled:opacity-60 min-h-[40px]"
        >
          Annuler
        </button>
        <button
          onClick={() => onConfirm(overrideFirstSession, isSolidarity)}
          disabled={actionLoading}
          className="px-4 py-2 text-sm font-medium font-sans rounded-xl bg-mint-600 text-white hover:bg-mint-700 transition-colors disabled:opacity-60 min-h-[40px]"
        >
          {actionLoading ? "En cours…" : "Confirmer"}
        </button>
      </div>
    </Modal>
  );
}