/**
 * AdminCreateButton — bouton "Nouveau rendez-vous" + modal de création manuelle.
 * Island React monté sur la page mes-rdvs avec client:load.
 */

import { useState, useMemo } from "react";
import {
  calculatePrice,
  SOLIDARITY_DISCOUNT,
  FIRST_SESSION_DISCOUNT,
} from "../../lib/pricing";
import type { AppointmentType, AppointmentDuration, AppointmentMode } from "../../lib/pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormState {
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  appointment_type: AppointmentType;
  appointment_mode: AppointmentMode;
  duration: AppointmentDuration;
  scheduled_at: string;
  patient_reason: string;
  override_first_session: boolean;
  is_solidarity: boolean;
  send_email: boolean;
  video_link: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPOINTMENT_TYPES: { value: AppointmentType; label: string }[] = [
  { value: "individual", label: "Thérapie individuelle" },
  { value: "couple", label: "Thérapie de couple" },
  { value: "family", label: "Thérapie familiale" },
];

const APPOINTMENT_MODES: { value: AppointmentMode; label: string }[] = [
  { value: "in-person", label: "Présentiel" },
  { value: "video", label: "Téléconsultation" },
];

const DURATIONS: { value: AppointmentDuration; label: string }[] = [
  { value: 60, label: "60 min" },
  { value: 90, label: "90 min" },
];

const INITIAL_STATE: FormState = {
  patient_name: "",
  patient_email: "",
  patient_phone: "",
  appointment_type: "individual",
  appointment_mode: "in-person",
  duration: 60,
  scheduled_at: "",
  patient_reason: "",
  override_first_session: false,
  is_solidarity: false,
  send_email: true,
  video_link: "",
};

// ---------------------------------------------------------------------------
// Sub-component: Label
// ---------------------------------------------------------------------------

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-sage-700 font-sans">
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Input
// ---------------------------------------------------------------------------

function Input({
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm text-sage-900 font-sans placeholder:text-sage-400 focus:border-mint-400 focus:outline-none focus:ring-2 focus:ring-mint-200"
    />
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AdminCreateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold font-sans
          rounded-xl bg-mint-700 text-white shadow-sm
          hover:bg-mint-800
          focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
          transition-colors min-h-[40px]
        "
        aria-label="Créer un rendez-vous manuellement"
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        Nouveau rendez-vous
      </button>
      {open && <AdminCreateModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal Component (internal)
// ---------------------------------------------------------------------------

function AdminCreateModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const livePrice = useMemo(
    () => calculatePrice(form.appointment_type, form.duration, form.override_first_session, form.is_solidarity),
    [form.appointment_type, form.duration, form.override_first_session, form.is_solidarity],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        patient_name: form.patient_name.trim(),
        patient_email: form.patient_email.trim(),
        patient_phone: form.patient_phone.trim() || undefined,
        appointment_type: form.appointment_type,
        appointment_mode: form.appointment_mode,
        duration: form.duration,
        scheduled_at: form.scheduled_at,
        patient_reason: form.patient_reason.trim(),
        override_first_session: form.override_first_session,
        is_solidarity: form.is_solidarity,
        send_email: form.send_email,
      };

      if (form.appointment_mode === "video" && form.video_link.trim()) {
        payload.video_link = form.video_link.trim();
      }

      const res = await fetch("/api/admin/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }

      // Succès : recharger la page pour afficher le nouveau RDV
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-4">
        {/* ── En-tête ── */}
        <div className="flex items-center justify-between mb-5">
          <h3 id="create-modal-title" className="font-serif text-lg font-semibold text-sage-800">
            Nouveau rendez-vous
          </h3>
          <button
            onClick={onClose}
            className="text-sage-400 hover:text-sage-600 transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* ── Formulaire ── */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Patient */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cm-name">Nom du patient *</Label>
              <Input
                id="cm-name"
                value={form.patient_name}
                onChange={v => update("patient_name", v)}
                placeholder="Marie Dupont"
                required
              />
            </div>
            <div>
              <Label htmlFor="cm-phone">Téléphone</Label>
              <Input
                id="cm-phone"
                type="tel"
                value={form.patient_phone}
                onChange={v => update("patient_phone", v)}
                placeholder="06 12 34 56 78"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="cm-email">Email du patient *</Label>
            <Input
              id="cm-email"
              type="email"
              value={form.patient_email}
              onChange={v => update("patient_email", v)}
              placeholder="marie@exemple.fr"
              required
            />
          </div>

          {/* Type / Mode / Durée */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="cm-type">Type de séance *</Label>
              <select
                id="cm-type"
                value={form.appointment_type}
                onChange={e => update("appointment_type", e.target.value as AppointmentType)}
                className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm text-sage-900 font-sans focus:border-mint-400 focus:outline-none focus:ring-2 focus:ring-mint-200"
              >
                {APPOINTMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="cm-mode">Mode *</Label>
              <select
                id="cm-mode"
                value={form.appointment_mode}
                onChange={e => update("appointment_mode", e.target.value as AppointmentMode)}
                className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm text-sage-900 font-sans focus:border-mint-400 focus:outline-none focus:ring-2 focus:ring-mint-200"
              >
                {APPOINTMENT_MODES.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="cm-duration">Durée *</Label>
              <select
                id="cm-duration"
                value={form.duration}
                onChange={e => update("duration", Number(e.target.value) as AppointmentDuration)}
                className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm text-sage-900 font-sans focus:border-mint-400 focus:outline-none focus:ring-2 focus:ring-mint-200"
              >
                {DURATIONS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date et heure */}
          <div>
            <Label htmlFor="cm-date">Date et heure *</Label>
            <Input
              id="cm-date"
              type="datetime-local"
              value={form.scheduled_at}
              onChange={v => update("scheduled_at", v)}
              required
            />
          </div>

          {/* Lien vidéo (conditionnel) */}
          {form.appointment_mode === "video" && (
            <div>
              <Label htmlFor="cm-video">Lien de téléconsultation <span className="font-normal text-sage-400">(optionnel — généré automatiquement si vide)</span></Label>
              <Input
                id="cm-video"
                type="url"
                value={form.video_link}
                onChange={v => update("video_link", v)}
                placeholder="Laissez vide pour auto-génération Google Meet"
              />
            </div>
          )}

          {/* Motif */}
          <div>
            <Label htmlFor="cm-reason">Motif / notes</Label>
            <textarea
              id="cm-reason"
              value={form.patient_reason}
              onChange={e => update("patient_reason", e.target.value)}
              rows={3}
              placeholder="Motif de consultation, contexte particulier…"
              className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm text-sage-900 font-sans placeholder:text-sage-400 focus:border-mint-400 focus:outline-none focus:ring-2 focus:ring-mint-200 resize-none"
            />
          </div>

          {/* ── Tarification ── */}
          <div className="rounded-xl border border-sage-200 bg-sage-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-sage-500 font-sans">
              Tarification
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.override_first_session && !form.is_solidarity}
                  onChange={e => {
                    if (e.target.checked) { update("override_first_session", true); update("is_solidarity", false); }
                    else update("override_first_session", false);
                  }}
                  className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                />
                <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
                  Remise nouveau client{" "}
                  <span className="text-sage-400">(−{FIRST_SESSION_DISCOUNT}€ première séance)</span>
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.is_solidarity}
                  onChange={e => {
                    if (e.target.checked) { update("is_solidarity", true); update("override_first_session", false); }
                    else update("is_solidarity", false);
                  }}
                  className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                />
                <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
                  Tarif solidaire{" "}
                  <span className="text-sage-400">(−{SOLIDARITY_DISCOUNT}€ · RSA / ASS / Étudiant)</span>
                </span>
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-sage-200 pt-3">
              <span className="text-xs text-sage-500 font-sans">
                Base {livePrice.basePrice}€
                {livePrice.discount > 0 && (
                  <span className="text-mint-700"> · remise −{livePrice.discount}€</span>
                )}
              </span>
              <span className="text-base font-semibold text-sage-900 font-sans">
                À régler : {livePrice.finalPrice}€
              </span>
            </div>
          </div>

          {/* ── Options ── */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={form.send_email}
              onChange={e => update("send_email", e.target.checked)}
              className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
            />
            <span className="text-sm text-sage-700 font-sans group-hover:text-sage-900">
              Envoyer un email au patient
              {form.appointment_mode === "video"
                ? " (lien de paiement Stripe)"
                : " (confirmation)"}
            </span>
          </label>

          {/* ── Erreur ── */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-sans">
              {error}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-xl border-2 border-sage-200 bg-white px-4 py-2.5 text-sm font-semibold text-sage-700 font-sans transition-colors hover:border-sage-400 hover:bg-sage-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-mint-700 px-4 py-2.5 text-sm font-semibold text-white font-sans shadow-sm transition-colors hover:bg-mint-800 disabled:opacity-50"
            >
              {loading ? "Création…" : "Créer le rendez-vous"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
