/**
 * CreateAppointmentDrawer — tiroir « Nouveau rendez-vous » du poste de
 * travail (proposition B, issue #148), fidèle aux écrans Figma
 * « Tiroir Nouveau RDV iPad » (drawer droit 440px) / iPhone (bottom sheet).
 *
 * Réutilise strictement les contrats existants :
 *  - POST /api/admin/appointments/ (même payload que <AdminCreateButton/>)
 *  - GET /api/admin/credits?email= pour l'avoir déductible
 *  - lib/pricing (calculatePrice) pour le tarif estimé
 *
 * Apports de la proposition B : recherche de patient parmi la patientèle
 * dérivée (`aggregatePatients`), créneaux suggérés calculés localement
 * (`suggestSlots`), saisie manuelle en repli. La création d'une fiche
 * patient autonome n'existe pas (#143) : la recherche ne fait que remplir
 * le formulaire.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Appointment } from '../../../types/appointment';
import type { PrefillData } from '../../../types/patient';
import type { AppointmentType, AppointmentMode } from '../../../lib/pricing';
import { calculatePrice } from '../../../lib/pricing';
import { aggregatePatients, suggestSlots } from '../../../utils/workbench';
import { Avatar } from './ui';

interface CreateAppointmentDrawerProps {
  open: boolean;
  appointments: Appointment[];
  prefill?: PrefillData | null;
  onClose: () => void;
}

interface FormState {
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  appointment_type: AppointmentType;
  appointment_mode: AppointmentMode;
  duration: number | 'custom';
  customDurationMinutes: number;
  scheduled_at: string;
  patient_reason: string;
  override_first_session: boolean;
  is_solidarity: boolean;
  send_email: boolean;
  useOverridePrice: boolean;
  overridePrice: number;
  use_credit: boolean;
  video_link: string;
}

const INITIAL_STATE: FormState = {
  patient_name: '',
  patient_email: '',
  patient_phone: '',
  appointment_type: 'individual',
  appointment_mode: 'in-person',
  duration: 60,
  customDurationMinutes: 45,
  scheduled_at: '',
  patient_reason: '',
  override_first_session: false,
  is_solidarity: false,
  send_email: true,
  useOverridePrice: false,
  overridePrice: 0,
  use_credit: false,
  video_link: '',
};

/** ISO → valeur `datetime-local` (heure locale du navigateur). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'individual', label: 'Individuelle' },
  { value: 'couple', label: 'Couple' },
  { value: 'family', label: 'Familiale' },
];

const MODE_OPTIONS: { value: AppointmentMode; label: string }[] = [
  { value: 'in-person', label: 'Présentiel' },
  { value: 'video', label: 'Téléconsultation' },
];

const DURATION_OPTIONS: { value: number | 'custom'; label: string }[] = [
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 'custom', label: 'Personnalisée…' },
];

export function CreateAppointmentDrawer({ open, appointments, prefill, onClose }: CreateAppointmentDrawerProps) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [selectedPatientEmail, setSelectedPatientEmail] = useState<string | null>(null);
  const [availableCredit, setAvailableCredit] = useState<number | null>(null);
  const [showManualDate, setShowManualDate] = useState(false);
  const [showOptions, setShowOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Ré)initialisation à l'ouverture, avec pré-remplissage éventuel (fiche patient).
  useEffect(() => {
    if (!open) return;
    setForm(
      prefill
        ? {
            ...INITIAL_STATE,
            patient_name: prefill.patient_name ?? '',
            patient_email: prefill.patient_email ?? '',
            patient_phone: prefill.patient_phone ?? '',
            appointment_type: prefill.appointment_type ?? 'individual',
          }
        : INITIAL_STATE,
    );
    setSelectedPatientEmail(prefill?.patient_email ?? null);
    setError(null);
    setShowManualDate(false);
  }, [open, prefill]);

  // Avoir disponible pour l'email saisi (même endpoint que la proposition A).
  useEffect(() => {
    const email = form.patient_email.trim();
    setAvailableCredit(null);
    setForm((f) => ({ ...f, use_credit: false }));
    if (!open || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const controller = new AbortController();
    fetch(`/api/admin/credits/?email=${encodeURIComponent(email)}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { available?: number };
        if (typeof body.available === 'number') setAvailableCredit(body.available);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [form.patient_email, open]);

  const patients = useMemo(() => aggregatePatients(appointments), [appointments]);
  const patientMatches = useMemo(() => {
    const q = form.patient_name.trim().toLowerCase();
    if (q.length < 2) return [];
    return patients
      .filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
      .slice(0, 3);
  }, [patients, form.patient_name]);

  const effectiveDuration = form.duration === 'custom' ? form.customDurationMinutes : form.duration;
  const suggestions = useMemo(
    () => (open ? suggestSlots(appointments, { durationMin: effectiveDuration, limit: 4 }) : []),
    [appointments, effectiveDuration, open],
  );

  const livePrice = useMemo(() => {
    if (form.useOverridePrice && form.overridePrice > 0) {
      return { finalPrice: form.overridePrice };
    }
    return calculatePrice(form.appointment_type, effectiveDuration, form.override_first_session, form.is_solidarity);
  }, [form.useOverridePrice, form.overridePrice, form.appointment_type, effectiveDuration, form.override_first_session, form.is_solidarity]);

  const creditEuros = useMemo(() => {
    if (!form.use_credit || availableCredit == null || availableCredit <= 0) return 0;
    return Math.min(availableCredit / 100, livePrice.finalPrice);
  }, [form.use_credit, availableCredit, livePrice.finalPrice]);
  const amountDueEuros = Math.max(0, livePrice.finalPrice - creditEuros);

  if (!open) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function selectPatient(email: string, name: string, phone: string, type: FormState['appointment_type']) {
    setSelectedPatientEmail(email);
    setForm((prev) => ({
      ...prev,
      patient_name: name,
      patient_email: email,
      patient_phone: phone,
      appointment_type: type,
    }));
  }

  async function handleSubmit() {
    setError(null);
    if (!form.patient_name.trim()) {
      setError('Le nom du patient est requis.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.patient_email.trim())) {
      setError('Un email valide est requis.');
      return;
    }
    if (!form.scheduled_at) {
      setError('Choisissez un créneau suggéré ou saisissez une date manuelle.');
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        patient_name: form.patient_name.trim(),
        patient_email: form.patient_email.trim(),
        patient_phone: form.patient_phone.trim() || undefined,
        appointment_type: form.appointment_type,
        appointment_mode: form.appointment_mode,
        duration: effectiveDuration,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        patient_reason: form.patient_reason.trim(),
        override_first_session: form.override_first_session,
        is_solidarity: form.is_solidarity,
        send_email: form.send_email,
        ...(form.useOverridePrice && form.overridePrice > 0 ? { override_price: form.overridePrice } : {}),
        ...(form.use_credit && availableCredit != null && availableCredit > 0 ? { use_credit: true } : {}),
        ...(form.appointment_mode === 'video' && form.video_link.trim() ? { video_link: form.video_link.trim() } : {}),
      };
      const res = await fetch('/api/admin/appointments/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status >= 500) {
          throw new Error(
            'Le serveur a mis du temps à répondre — le rendez-vous a peut-être été créé. Vérifiez la liste avant de retenter.',
          );
        }
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      window.location.reload();
    } catch (e) {
      setError(
        e instanceof TypeError
          ? 'Le serveur a mis du temps à répondre — le rendez-vous a peut-être été créé. Vérifiez la liste avant de retenter.'
          : e instanceof Error
            ? e.message
            : 'Une erreur est survenue',
      );
      setLoading(false);
    }
  }

  const showSuggestions = patientMatches.length === 0;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Nouveau rendez-vous">
      <button
        type="button"
        aria-label="Fermer le tiroir"
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-black/40 cursor-default"
      />
      <div
        className="
          absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-white shadow-xl
          sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[460px] sm:max-h-none sm:rounded-t-none sm:rounded-l-3xl
        "
      >
        <span className="sm:hidden mx-auto mt-3 mb-1 block h-1.5 w-12 rounded-full bg-sage-200" aria-hidden="true" />
        <div className="p-5 sm:p-6">
          {/* En-tête */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl font-semibold text-sage-900">Nouveau rendez-vous</h2>
              <p className="text-sm text-sage-500 font-sans mt-0.5">
                Un seul rendez-vous par validation — le formulaire se réinitialise ensuite.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full text-sage-400 hover:text-sage-700 hover:bg-sage-100 focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors shrink-0"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="mt-5 space-y-5"
          >
            {/* 1. Patient */}
            <section aria-label="Patient">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold font-sans uppercase tracking-wider text-sage-600">1. Patient</h3>
                {selectedPatientEmail && (
                  <span className="inline-flex items-center rounded-full bg-mint-100 px-2.5 py-0.5 text-xs font-medium font-sans text-mint-900">
                    <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mr-1.5" aria-hidden="true" />
                    Patient existant
                  </span>
                )}
              </div>
              <label htmlFor="wb-create-name" className="sr-only">
                Rechercher ou saisir le nom du patient
              </label>
              <input
                id="wb-create-name"
                type="text"
                value={form.patient_name}
                onChange={(e) => {
                  update('patient_name', e.target.value);
                  setSelectedPatientEmail(null);
                }}
                placeholder="Rechercher ou créer un patient…"
                autoComplete="off"
                className="
                  mt-2 w-full rounded-xl border border-sage-200 px-3 py-2.5 text-sm font-sans text-sage-900
                  placeholder-sage-400 focus:outline-none focus:ring-2 focus:ring-mint-400
                  focus:border-transparent transition-colors min-h-[44px]
                "
              />
              {form.patient_name.trim().length >= 2 && (
                <ul className="mt-2 space-y-2">
                  {patientMatches.map((patient) => (
                    <li key={patient.email}>
                      <button
                        type="button"
                        onClick={() => selectPatient(patient.email, patient.name, patient.phone, patient.lastType)}
                        className="
                          w-full flex items-center gap-3 rounded-xl border border-mint-200 bg-mint-50 px-3 py-2.5
                          text-left hover:border-mint-400 focus:outline-none focus:ring-2 focus:ring-mint-400
                          transition-colors
                        "
                      >
                        <Avatar name={patient.name} className="w-9 h-9 text-xs" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold font-sans text-sage-900 truncate">
                            {patient.name}
                          </span>
                          <span className="block text-xs font-sans text-sage-500 truncate">
                            {patient.phone || patient.email} · {patient.sessionCount} séance{patient.sessionCount > 1 ? 's' : ''} précédente{patient.sessionCount > 1 ? 's' : ''}
                          </span>
                        </span>
                        {selectedPatientEmail === patient.email && (
                          <span className="text-xs font-semibold font-sans text-mint-700 shrink-0">✓ Sélectionné</span>
                        )}
                      </button>
                    </li>
                  ))}
                  {!patientMatches.some((p) => p.name.toLowerCase() === form.patient_name.trim().toLowerCase()) && (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPatientEmail(null);
                          setForm((prev) => ({ ...prev, patient_email: '', patient_phone: '' }));
                        }}
                        className="w-full rounded-xl border border-dashed border-sage-300 px-3 py-2.5 text-left text-sm font-sans text-sage-600 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors"
                      >
                        + Nouveau patient « {form.patient_name.trim()} »
                        <span className="block text-xs text-sage-400 mt-0.5">
                          Saisissez ses coordonnées ci-dessous — fiche dérivée de ce rendez-vous (#143 pour une fiche autonome)
                        </span>
                      </button>
                    </li>
                  )}
                </ul>
              )}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wb-create-email" className="mb-1 block text-sm font-medium font-sans text-sage-700">
                    Email
                  </label>
                  <input
                    id="wb-create-email"
                    type="email"
                    required
                    value={form.patient_email}
                    onChange={(e) => update('patient_email', e.target.value)}
                    className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  />
                </div>
                <div>
                  <label htmlFor="wb-create-phone" className="mb-1 block text-sm font-medium font-sans text-sage-700">
                    Téléphone
                  </label>
                  <input
                    id="wb-create-phone"
                    type="tel"
                    value={form.patient_phone}
                    onChange={(e) => update('patient_phone', e.target.value)}
                    className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  />
                </div>
              </div>
            </section>

            {/* 2. Séance */}
            <section aria-label="Séance">
              <h3 className="text-xs font-bold font-sans uppercase tracking-wider text-sage-600">2. Séance</h3>
              <div className="mt-2 grid grid-cols-3 gap-2.5">
                <div>
                  <label htmlFor="wb-create-type" className="mb-1 block text-sm font-medium font-sans text-sage-700">Type</label>
                  <select
                    id="wb-create-type"
                    value={form.appointment_type}
                    onChange={(e) => update('appointment_type', e.target.value as AppointmentType)}
                    className="w-full rounded-xl border border-sage-200 px-2.5 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  >
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="wb-create-mode" className="mb-1 block text-sm font-medium font-sans text-sage-700">Mode</label>
                  <select
                    id="wb-create-mode"
                    value={form.appointment_mode}
                    onChange={(e) => update('appointment_mode', e.target.value as AppointmentMode)}
                    className="w-full rounded-xl border border-sage-200 px-2.5 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  >
                    {MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="wb-create-duration" className="mb-1 block text-sm font-medium font-sans text-sage-700">Durée</label>
                  <select
                    id="wb-create-duration"
                    value={String(form.duration)}
                    onChange={(e) =>
                      update('duration', e.target.value === 'custom' ? 'custom' : Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-sage-200 px-2.5 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  >
                    {DURATION_OPTIONS.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {form.duration === 'custom' && (
                <div className="mt-2.5">
                  <label htmlFor="wb-create-custom-duration" className="mb-1 block text-sm font-medium font-sans text-sage-700">
                    Durée personnalisée (minutes)
                  </label>
                  <input
                    id="wb-create-custom-duration"
                    type="number"
                    min={15}
                    max={240}
                    value={form.customDurationMinutes}
                    onChange={(e) => update('customDurationMinutes', Number(e.target.value))}
                    className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  />
                </div>
              )}
            </section>

            {/* 3. Créneaux suggérés */}
            {showSuggestions && (
              <section aria-label="Créneaux suggérés">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold font-sans uppercase tracking-wider text-sage-600">
                    3. Créneaux suggérés
                  </h3>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium font-sans text-mint-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-mint-500" aria-hidden="true" />
                    D'après votre agenda
                  </span>
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-2.5">
                  {suggestions.map((slot, idx) => {
                    const isSelected = form.scheduled_at === isoToLocalInput(slot.startIso);
                    return (
                      <li key={slot.startIso}>
                        <button
                          type="button"
                          onClick={() => update('scheduled_at', isoToLocalInput(slot.startIso))}
                          aria-pressed={isSelected}
                          className={`
                            w-full rounded-xl border px-3 py-2.5 text-left transition-colors
                            focus:outline-none focus:ring-2 focus:ring-mint-400
                            ${isSelected ? 'border-mint-500 bg-mint-50 ring-1 ring-mint-400' : 'border-sage-200 bg-white hover:border-mint-300'}
                          `}
                        >
                          <span className="flex items-center justify-between gap-1.5">
                            <span className="text-[10px] font-bold font-sans uppercase tracking-wide text-sage-500 truncate">
                              {slot.dayLabel}
                            </span>
                            {idx === 0 && (
                              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold font-sans uppercase tracking-wide text-amber-800">
                                Recommandé
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block font-serif text-sm font-semibold text-sage-900 tabular-nums">
                            {slot.timeLabel}
                          </span>
                          {slot.hint && (
                            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-sans text-mint-700">
                              <span className="w-1 h-1 rounded-full bg-mint-500" aria-hidden="true" />
                              {slot.hint}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {suggestions.length === 0 && (
                    <li className="col-span-2 rounded-xl border border-dashed border-sage-300 px-3 py-2.5 text-sm font-sans text-sage-500">
                      Aucun créneau libre trouvé dans les prochains jours — définissez une date manuelle.
                    </li>
                  )}
                </ul>
              </section>
            )}

            {/* Date manuelle */}
            <div>
              <button
                type="button"
                onClick={() => setShowManualDate(!showManualDate)}
                aria-expanded={showManualDate}
                className="text-sm font-medium font-sans text-sage-700 hover:text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 rounded"
              >
                {showManualDate ? '−' : '+'} Définir une date &amp; heure manuelle (exception)
              </button>
              {showManualDate && (
                <div className="mt-2">
                  <label htmlFor="wb-create-date" className="sr-only">
                    Date et heure du rendez-vous
                  </label>
                  <input
                    id="wb-create-date"
                    type="datetime-local"
                    value={form.scheduled_at}
                    onChange={(e) => update('scheduled_at', e.target.value)}
                    className="w-full rounded-xl border border-sage-200 px-3 py-2.5 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                  />
                </div>
              )}
            </div>

            {/* Options & honoraires */}
            <div className="rounded-xl border border-sage-200">
              <button
                type="button"
                onClick={() => setShowOptions(!showOptions)}
                aria-expanded={showOptions}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold font-sans text-sage-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-mint-400 rounded-xl"
              >
                Options &amp; honoraires
                <span className="text-xs font-normal text-mint-700 underline">{showOptions ? 'Masquer' : 'Afficher'}</span>
              </button>
              {showOptions && (
                <div className="px-4 pb-4 space-y-2.5 border-t border-sage-100 pt-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <label className="inline-flex items-center gap-2 text-sm font-sans text-sage-700">
                      <input
                        type="checkbox"
                        checked={form.override_first_session}
                        onChange={(e) => update('override_first_session', e.target.checked)}
                        className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                      />
                      1<sup>re</sup> séance
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm font-sans text-sage-700">
                      <input
                        type="checkbox"
                        checked={form.is_solidarity}
                        onChange={(e) => update('is_solidarity', e.target.checked)}
                        className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                      />
                      Solidaire
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm font-sans text-sage-700">
                      <input
                        type="checkbox"
                        checked={form.send_email}
                        onChange={(e) => update('send_email', e.target.checked)}
                        className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                      />
                      Email de confirmation
                    </label>
                  </div>
                  <div className="flex items-end gap-3">
                    <label className="inline-flex items-center gap-2 text-sm font-sans text-sage-700">
                      <input
                        type="checkbox"
                        checked={form.useOverridePrice}
                        onChange={(e) => update('useOverridePrice', e.target.checked)}
                        className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                      />
                      Tarif manuel
                    </label>
                    {form.useOverridePrice && (
                      <div>
                        <label htmlFor="wb-create-price" className="sr-only">Tarif en euros</label>
                        <input
                          id="wb-create-price"
                          type="number"
                          min={0}
                          value={form.overridePrice}
                          onChange={(e) => update('overridePrice', Number(e.target.value))}
                          className="w-24 rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                        />
                      </div>
                    )}
                    <span className="text-xs font-sans text-sage-400">
                      Défaut : {livePrice.finalPrice} €
                    </span>
                  </div>
                  {form.appointment_mode === 'video' && (
                    <div>
                      <label htmlFor="wb-create-video" className="mb-1 block text-sm font-medium font-sans text-sage-700">
                        Lien visio (optionnel — sinon généré plus tard)
                      </label>
                      <input
                        id="wb-create-video"
                        type="url"
                        value={form.video_link}
                        onChange={(e) => update('video_link', e.target.value)}
                        placeholder="https://meet.google.com/…"
                        className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900 placeholder-sage-400 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor="wb-create-reason" className="mb-1 block text-sm font-medium font-sans text-sage-700">
                      Motif (optionnel)
                    </label>
                    <input
                      id="wb-create-reason"
                      type="text"
                      value={form.patient_reason}
                      onChange={(e) => update('patient_reason', e.target.value)}
                      className="w-full rounded-xl border border-sage-200 px-3 py-2 text-sm font-sans text-sage-900 focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[44px]"
                    />
                  </div>
                  {availableCredit != null && availableCredit > 0 && (
                    <label className="inline-flex items-center gap-2 text-sm font-sans text-sage-700">
                      <input
                        type="checkbox"
                        checked={form.use_credit}
                        onChange={(e) => update('use_credit', e.target.checked)}
                        className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
                      />
                      Utiliser l'avoir disponible ({(availableCredit / 100).toFixed(2)} €)
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Tarif estimé */}
            <p className="rounded-xl bg-mint-100 px-4 py-3 text-center text-sm font-sans text-sage-900">
              Tarif estimé :{' '}
              <span className="font-serif text-lg font-semibold">{amountDueEuros.toFixed(2).replace(/\.00$/, '')} €</span>
              {creditEuros > 0 && <span className="text-xs text-mint-700"> (après avoir de {creditEuros.toFixed(2)} €)</span>}
            </p>

            {error && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-sans">
                {error}
              </p>
            )}

            {/* Pied du tiroir */}
            <div className="flex gap-3 pb-[env(safe-area-inset-bottom)]">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border-2 border-sage-200 bg-white px-4 py-2.5 text-sm font-semibold font-sans text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors min-h-[44px]"
              >
                Terminer
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl bg-sage-900 px-4 py-2.5 text-sm font-semibold font-sans text-white hover:bg-sage-800 focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]"
              >
                {loading ? 'Création…' : 'Créer ce rendez-vous'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
