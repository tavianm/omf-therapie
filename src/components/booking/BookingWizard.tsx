/**
 * BookingWizard — Island React (client:load)
 *
 * Formulaire de réservation multi-étapes pour OMF Thérapie.
 * Étapes : Type & Mode → Date & Heure → Informations → Récapitulatif → Confirmation
 */

import { useEffect, useState } from 'react';
import { useBooking } from '../../hooks/useBooking';
import type { BookingState, BookingStep } from '../../hooks/useBooking';
import { getTypeLabel, getModeLabel } from '../../lib/pricing';

// ---------------------------------------------------------------------------
// Types locaux
// ---------------------------------------------------------------------------

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface SlotGroup {
  dateKey: string;
  dateLabel: string;
  slots: TimeSlot[];
}

// ---------------------------------------------------------------------------
// Helpers de formatage (heure Paris)
// ---------------------------------------------------------------------------

function formatDateLabel(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(isoString));
}

function formatTime(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(isoString));
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function groupSlotsByDay(slots: TimeSlot[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>();

  for (const slot of slots) {
    if (!slot.available) continue;
    const date = new Date(slot.start);
    // Clé YYYY-MM-DD en heure Paris
    const key = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Europe/Paris',
    })
      .format(date)
      .split('/')
      .reverse()
      .join('-');

    if (!groups.has(key)) {
      groups.set(key, {
        dateKey: key,
        dateLabel: capitalize(formatDateLabel(slot.start)),
        slots: [],
      });
    }
    groups.get(key)!.slots.push(slot);
  }

  return Array.from(groups.values());
}

function formatScheduledAt(isoString: string): string {
  return `${capitalize(formatDateLabel(isoString))} à ${formatTime(isoString)}`;
}

// ---------------------------------------------------------------------------
// Accent color (hors palette Tailwind)
// ---------------------------------------------------------------------------

const ACCENT = '#d4a96a';

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------

const WIZARD_STEPS: { key: BookingStep; label: string }[] = [
  { key: 'type-mode', label: 'Type & Mode' },
  { key: 'datetime', label: 'Date & Heure' },
  { key: 'patient-info', label: 'Informations' },
  { key: 'review', label: 'Récapitulatif' },
];

function StepIndicator({ currentStep }: { currentStep: BookingStep }) {
  if (currentStep === 'submitted') return null;

  const currentIndex = WIZARD_STEPS.findIndex(s => s.key === currentStep);

  return (
    <nav aria-label="Étapes de la réservation" className="mb-8">
      <ol className="flex items-center justify-between">
        {WIZARD_STEPS.map((step, index) => {
          const isDone = index < currentIndex;
          const isActive = index === currentIndex;

          return (
            <li key={step.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={`
                    flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold
                    transition-all duration-200
                    ${isDone ? 'bg-sage-600 text-white' : ''}
                    ${isActive ? 'text-white ring-2 ring-offset-2' : ''}
                    ${!isDone && !isActive ? 'bg-sage-100 text-sage-400' : ''}
                  `}
                  style={isActive ? { backgroundColor: ACCENT, outlineColor: ACCENT } : undefined}
                >
                  {isDone ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={`hidden text-xs font-medium sm:block ${isActive ? 'text-sage-800' : 'text-sage-400'}`}>
                  {step.label}
                </span>
              </div>

              {index < WIZARD_STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 transition-colors duration-200 ${
                    isDone ? 'bg-sage-600' : 'bg-sage-200'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Étape 1 — Type & Mode
// ---------------------------------------------------------------------------

function TypeModeStep({
  state,
  updateField,
  nextStep,
  isValid,
  pricingLabel,
}: {
  state: BookingState;
  updateField: <K extends keyof BookingState>(field: K, value: BookingState[K]) => void;
  nextStep: () => void;
  isValid: boolean;
  pricingLabel: string | null;
}) {
  const types: { value: 'individual' | 'couple' | 'family'; label: string; emoji: string; desc: string }[] = [
    { value: 'individual', label: 'Individuelle', emoji: '🌿', desc: 'Séance en tête-à-tête' },
    { value: 'couple', label: 'Couple', emoji: '💞', desc: 'Thérapie de couple' },
    { value: 'family', label: 'Familiale', emoji: '🏡', desc: 'Thérapie familiale' },
  ];

  const modes: { value: 'in-person' | 'video'; label: string; emoji: string; desc: string }[] = [
    { value: 'in-person', label: 'Présentiel', emoji: '📍', desc: 'Mercredi uniquement — au cabinet' },
    { value: 'video', label: 'Téléconsultation', emoji: '💻', desc: 'Lundi au vendredi — en ligne' },
  ];

  return (
    <div className="space-y-8">

      {/* Type de thérapie */}
      <fieldset>
        <legend className="mb-4 text-base font-semibold text-sage-800">
          Type de thérapie
        </legend>
        <div className="grid grid-cols-3 gap-3">
          {types.map(type => (
            <button
              key={type.value}
              type="button"
              onClick={() => updateField('appointment_type', type.value)}
              className={`
                flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all duration-150
                hover:border-sage-400 hover:bg-sage-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-600
                ${state.appointment_type === type.value
                  ? 'border-sage-600 bg-sage-50 shadow-sm'
                  : 'border-sage-200 bg-white'
                }
              `}
              aria-pressed={state.appointment_type === type.value}
            >
              <span className="text-2xl">{type.emoji}</span>
              <span className="text-sm font-semibold text-sage-800">{type.label}</span>
              <span className="text-xs text-sage-500">{type.desc}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Mode */}
      <fieldset>
        <legend className="mb-4 text-base font-semibold text-sage-800">
          Mode de consultation
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {modes.map(mode => (
            <button
              key={mode.value}
              type="button"
              onClick={() => updateField('appointment_mode', mode.value)}
              className={`
                flex flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all duration-150
                hover:border-sage-400 hover:bg-sage-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-600
                ${state.appointment_mode === mode.value
                  ? 'border-sage-600 bg-sage-50 shadow-sm'
                  : 'border-sage-200 bg-white'
                }
              `}
              aria-pressed={state.appointment_mode === mode.value}
            >
              <span className="text-xl">{mode.emoji}</span>
              <span className="text-sm font-semibold text-sage-800">{mode.label}</span>
              <span className="text-xs text-sage-500">{mode.desc}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Durée */}
      <fieldset>
        <legend className="mb-4 text-base font-semibold text-sage-800">
          Durée de la séance
        </legend>
        <div className="flex gap-3">
          {([60, 90] as const).map(dur => (
            <label
              key={dur}
              className={`
                flex flex-1 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all duration-150
                hover:border-sage-400 hover:bg-sage-50
                ${state.duration === dur
                  ? 'border-sage-600 bg-sage-50'
                  : 'border-sage-200 bg-white'
                }
              `}
            >
              <input
                type="radio"
                name="duration"
                value={dur}
                checked={state.duration === dur}
                onChange={() => updateField('duration', dur)}
                className="accent-sage-600"
              />
              <span className="text-sm font-semibold text-sage-800">{dur} min</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Première consultation */}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-mint-200 bg-mint-50 px-4 py-3">
        <input
          type="checkbox"
          checked={state.is_first_session}
          onChange={e => updateField('is_first_session', e.target.checked)}
          className="h-4 w-4 accent-sage-600"
        />
        <span className="text-sm text-sage-700">
          C'est ma <span className="font-semibold">première consultation</span>
          <span className="ml-1 text-xs text-sage-500">(−15€ de réduction)</span>
        </span>
      </label>

      {/* Tarif temps réel */}
      {pricingLabel && (
        <div
          className="flex items-center justify-between rounded-xl px-5 py-4"
          style={{ backgroundColor: `${ACCENT}15`, border: `1.5px solid ${ACCENT}40` }}
        >
          <span className="text-sm font-medium text-sage-700">Tarif estimé</span>
          <span className="text-lg font-bold text-sage-800" style={{ color: ACCENT }}>
            {pricingLabel}
          </span>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={nextStep}
          disabled={!isValid}
          className={`
            inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold
            text-white transition-all duration-150
            focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-40
          `}
          style={{ backgroundColor: isValid ? ACCENT : undefined }}
        >
          Choisir un créneau
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 2 — Calendrier
// ---------------------------------------------------------------------------

function DatetimeStep({
  state,
  updateField,
  nextStep,
  prevStep,
  isValid,
}: {
  state: BookingState;
  updateField: <K extends keyof BookingState>(field: K, value: BookingState[K]) => void;
  nextStep: () => void;
  prevStep: () => void;
  isValid: boolean;
}) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.appointment_mode || !state.duration) return;

    setIsLoading(true);
    setFetchError(null);

    fetch(
      `/api/availability/?mode=${state.appointment_mode}&duration=${state.duration}&weeks=4`,
    )
      .then(res => {
        if (!res.ok) throw new Error('Impossible de charger les disponibilités.');
        return res.json() as Promise<{ slots: TimeSlot[] }>;
      })
      .then(data => {
        setSlots(data.slots);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Erreur inconnue.';
        setFetchError(message);
        setIsLoading(false);
      });
  }, [state.appointment_mode, state.duration]);

  const groups = groupSlotsByDay(slots);

  return (
    <div className="space-y-6">
      <p className="text-sm text-sage-600">
        Sélectionnez un créneau disponible pour votre séance en{' '}
        <span className="font-medium">
          {state.appointment_mode === 'in-person' ? 'présentiel' : 'téléconsultation'}
        </span>{' '}
        ({state.duration} min).
      </p>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4" aria-live="polite" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="animate-pulse rounded-xl border border-sage-200 bg-white p-4">
              <div className="mb-3 h-4 w-40 rounded bg-sage-100" />
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3].map(j => (
                  <div key={j} className="h-9 w-16 rounded-lg bg-sage-100" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Erreur */}
      {!isLoading && fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span className="font-semibold">Erreur :</span> {fetchError}
        </div>
      )}

      {/* Aucun créneau */}
      {!isLoading && !fetchError && groups.length === 0 && (
        <div className="rounded-xl border border-sage-200 bg-sage-50 px-5 py-8 text-center">
          <p className="text-sm text-sage-600">
            Aucun créneau disponible dans les 4 prochaines semaines.
          </p>
          <p className="mt-1 text-xs text-sage-500">
            Vous pouvez nous contacter directement pour trouver un arrangement.
          </p>
        </div>
      )}

      {/* Créneaux groupés par jour */}
      {!isLoading && !fetchError && groups.length > 0 && (
        <div className="space-y-4" role="list" aria-label="Créneaux disponibles">
          {groups.map(group => (
            <div
              key={group.dateKey}
              role="listitem"
              className="rounded-xl border border-sage-200 bg-white p-4 shadow-sm"
            >
              <h3 className="mb-3 text-sm font-semibold text-sage-800">{group.dateLabel}</h3>
              <div className="flex flex-wrap gap-2">
                {group.slots.map(slot => {
                  const isSelected = state.scheduled_at === slot.start;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      onClick={() => updateField('scheduled_at', slot.start)}
                      className={`
                        rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all duration-150
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
                        ${isSelected
                          ? 'text-white shadow-sm'
                          : 'border-sage-200 bg-white text-sage-700 hover:border-sage-400 hover:bg-sage-50'
                        }
                      `}
                      style={isSelected ? { backgroundColor: ACCENT, borderColor: ACCENT } : undefined}
                      aria-pressed={isSelected}
                    >
                      {formatTime(slot.start)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={prevStep}
          className="inline-flex items-center gap-2 rounded-xl border-2 border-sage-200 bg-white px-5 py-2.5 text-sm font-semibold text-sage-700 transition-colors hover:border-sage-400 hover:bg-sage-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!isValid}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: isValid ? ACCENT : undefined }}
        >
          Continuer
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 3 — Informations patient
// ---------------------------------------------------------------------------

function PatientInfoStep({
  state,
  updateField,
  nextStep,
  prevStep,
  isValid,
}: {
  state: BookingState;
  updateField: <K extends keyof BookingState>(field: K, value: BookingState[K]) => void;
  nextStep: () => void;
  prevStep: () => void;
  isValid: boolean;
}) {
  const reasonLength = state.patient_reason.trim().length;
  const MAX_REASON = 1500;

  const inputClass = (value: string) =>
    `w-full rounded-xl border-2 px-4 py-2.5 text-sm text-sage-800 placeholder:text-sage-400
     transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-600
     ${value.length > 0 ? 'border-sage-300' : 'border-sage-200'} bg-white`;

  return (
    <div className="space-y-5">
      <p className="text-sm text-sage-600">
        Ces informations resteront confidentielles et ne seront utilisées que pour la prise en charge de votre rendez-vous.
      </p>

      {/* Nom complet */}
      <div>
        <label htmlFor="patient_name" className="mb-1.5 block text-sm font-medium text-sage-700">
          Nom complet <span className="text-red-500">*</span>
        </label>
        <input
          id="patient_name"
          type="text"
          autoComplete="name"
          required
          value={state.patient_name}
          onChange={e => updateField('patient_name', e.target.value)}
          placeholder="Marie Dupont"
          className={inputClass(state.patient_name)}
        />
      </div>

      {/* Email */}
      <div>
        <label htmlFor="patient_email" className="mb-1.5 block text-sm font-medium text-sage-700">
          Adresse email <span className="text-red-500">*</span>
        </label>
        <input
          id="patient_email"
          type="email"
          autoComplete="email"
          required
          value={state.patient_email}
          onChange={e => updateField('patient_email', e.target.value)}
          placeholder="marie@example.com"
          className={inputClass(state.patient_email)}
        />
      </div>

      {/* Téléphone */}
      <div>
        <label htmlFor="patient_phone" className="mb-1.5 block text-sm font-medium text-sage-700">
          Téléphone <span className="text-red-500">*</span>
        </label>
        <input
          id="patient_phone"
          type="tel"
          autoComplete="tel"
          required
          value={state.patient_phone}
          onChange={e => updateField('patient_phone', e.target.value)}
          placeholder="06 12 34 56 78"
          className={inputClass(state.patient_phone)}
        />
        <p className="mt-1 text-xs text-sage-500">Format français : 06 xx xx xx xx ou +33 6 xx xx xx xx</p>
      </div>

      {/* Code postal + Ville (sur 2 colonnes) */}
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-2">
          <label htmlFor="patient_postal_code" className="mb-1.5 block text-sm font-medium text-sage-700">
            Code postal <span className="text-red-500">*</span>
          </label>
          <input
            id="patient_postal_code"
            type="text"
            autoComplete="postal-code"
            required
            maxLength={5}
            value={state.patient_postal_code}
            onChange={e => updateField('patient_postal_code', e.target.value.replace(/\D/g, ''))}
            placeholder="75001"
            className={inputClass(state.patient_postal_code)}
          />
        </div>
        <div className="col-span-3">
          <label htmlFor="patient_city" className="mb-1.5 block text-sm font-medium text-sage-700">
            Ville <span className="text-red-500">*</span>
          </label>
          <input
            id="patient_city"
            type="text"
            autoComplete="address-level2"
            required
            value={state.patient_city}
            onChange={e => updateField('patient_city', e.target.value)}
            placeholder="Paris"
            className={inputClass(state.patient_city)}
          />
        </div>
      </div>

      {/* Motif */}
      <div>
        <label htmlFor="patient_reason" className="mb-1.5 block text-sm font-medium text-sage-700">
          Motif de consultation <span className="text-red-500">*</span>
        </label>
        <textarea
          id="patient_reason"
          required
          rows={4}
          maxLength={MAX_REASON}
          value={state.patient_reason}
          onChange={e => updateField('patient_reason', e.target.value)}
          placeholder="Décrivez brièvement ce qui vous amène à consulter..."
          className={`${inputClass(state.patient_reason)} resize-none`}
        />
        <div className="mt-1 flex justify-between text-xs text-sage-500">
          <span>Minimum 10 caractères</span>
          <span className={reasonLength > MAX_REASON ? 'text-red-500' : ''}>
            {reasonLength} / {MAX_REASON}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={prevStep}
          className="inline-flex items-center gap-2 rounded-xl border-2 border-sage-200 bg-white px-5 py-2.5 text-sm font-semibold text-sage-700 transition-colors hover:border-sage-400 hover:bg-sage-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Retour
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!isValid}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: isValid ? ACCENT : undefined }}
        >
          Vérifier
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne de récap
// ---------------------------------------------------------------------------

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 text-sm">
      <span className="w-36 shrink-0 font-medium text-sage-600">{label}</span>
      <span className="text-sage-800">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 4 — Récapitulatif
// ---------------------------------------------------------------------------

function ReviewStep({
  state,
  prevStep,
  submitBooking,
  pricingLabel,
}: {
  state: BookingState;
  prevStep: () => void;
  submitBooking: () => Promise<void>;
  pricingLabel: string | null;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-sage-600">
        Vérifiez vos informations avant d'envoyer votre demande de rendez-vous.
      </p>

      {/* Bloc séance */}
      <section className="rounded-xl border border-sage-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-sage-500">
          Séance
        </h3>
        <div className="divide-y divide-sage-100">
          {state.appointment_type && (
            <ReviewRow label="Type" value={getTypeLabel(state.appointment_type)} />
          )}
          {state.appointment_mode && (
            <ReviewRow label="Mode" value={getModeLabel(state.appointment_mode)} />
          )}
          {state.scheduled_at && (
            <ReviewRow label="Date & heure" value={formatScheduledAt(state.scheduled_at)} />
          )}
          {state.duration && (
            <ReviewRow label="Durée" value={`${state.duration} minutes`} />
          )}
          <ReviewRow
            label="Première séance"
            value={state.is_first_session ? 'Oui' : 'Non'}
          />
          {pricingLabel && (
            <div className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-36 shrink-0 font-medium text-sage-600">Tarif</span>
              <span className="font-semibold text-sage-800" style={{ color: ACCENT }}>
                {pricingLabel}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Bloc patient */}
      <section className="rounded-xl border border-sage-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-sage-500">
          Vos informations
        </h3>
        <div className="divide-y divide-sage-100">
          <ReviewRow label="Nom" value={state.patient_name} />
          <ReviewRow label="Email" value={state.patient_email} />
          <ReviewRow label="Téléphone" value={state.patient_phone} />
          <ReviewRow
            label="Localisation"
            value={`${state.patient_postal_code} ${state.patient_city}`}
          />
          <div className="py-2.5 text-sm">
            <span className="font-medium text-sage-600">Motif</span>
            <p className="mt-1 whitespace-pre-wrap text-sage-800">{state.patient_reason}</p>
          </div>
        </div>
      </section>

      {/* Mentions */}
      <div className="space-y-2 rounded-xl bg-sage-50 px-4 py-3">
        <p className="text-xs text-sage-600">
          🔒 Vos données sont traitées conformément à notre{' '}
          <a href="/confidentialite" className="underline hover:text-sage-800">
            politique de confidentialité
          </a>.
        </p>
        {state.appointment_mode === 'video' && (
          <p className="text-xs text-sage-600">
            💳 Pour les séances en téléconsultation, un{' '}
            <strong>prépaiement sécurisé</strong> vous sera demandé après confirmation.
          </p>
        )}
      </div>

      {/* Erreur de soumission */}
      {state.submitError && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          <span className="font-semibold">Erreur :</span> {state.submitError}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={prevStep}
          disabled={state.isSubmitting}
          className="inline-flex items-center gap-2 rounded-xl border-2 border-sage-200 bg-white px-5 py-2.5 text-sm font-semibold text-sage-700 transition-colors hover:border-sage-400 hover:bg-sage-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-600 disabled:opacity-40"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Modifier
        </button>
        <button
          type="button"
          onClick={submitBooking}
          disabled={state.isSubmitting}
          className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: ACCENT }}
        >
          {state.isSubmitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Envoi en cours…
            </>
          ) : (
            <>
              Envoyer ma demande
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 5 — Confirmation
// ---------------------------------------------------------------------------

function SubmittedStep() {
  return (
    <div className="py-6 text-center">
      <div
        className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: `${ACCENT}20` }}
      >
        <svg
          className="h-10 w-10"
          fill="none"
          viewBox="0 0 24 24"
          stroke={ACCENT}
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="mb-3 font-serif text-2xl text-sage-800">
        Demande envoyée avec succès
      </h2>

      <p className="mx-auto mb-2 max-w-sm text-sm text-sage-600">
        Votre demande de rendez-vous a bien été transmise.
      </p>
      <p className="mx-auto mb-8 max-w-sm text-sm text-sage-600">
        Vous recevrez un <strong>email de confirmation</strong> sous 24–48 h après validation par Oriane.
      </p>

      <a
        href="/"
        className="inline-flex items-center gap-2 rounded-xl border-2 border-sage-200 bg-white px-6 py-2.5 text-sm font-semibold text-sage-700 transition-colors hover:border-sage-400 hover:bg-sage-50"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Retour à l'accueil
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BookingWizard — export principal
// ---------------------------------------------------------------------------

export default function BookingWizard() {
  const { state, updateField, nextStep, prevStep, submitBooking, pricing, isStepValid } =
    useBooking();

  return (
    <div className="rounded-2xl border border-sage-200 bg-white p-6 shadow-md sm:p-8">
      <StepIndicator currentStep={state.step} />

      {state.step === 'type-mode' && (
        <TypeModeStep
          state={state}
          updateField={updateField}
          nextStep={nextStep}
          isValid={isStepValid('type-mode')}
          pricingLabel={pricing?.label ?? null}
        />
      )}

      {state.step === 'datetime' && (
        <DatetimeStep
          state={state}
          updateField={updateField}
          nextStep={nextStep}
          prevStep={prevStep}
          isValid={isStepValid('datetime')}
        />
      )}

      {state.step === 'patient-info' && (
        <PatientInfoStep
          state={state}
          updateField={updateField}
          nextStep={nextStep}
          prevStep={prevStep}
          isValid={isStepValid('patient-info')}
        />
      )}

      {state.step === 'review' && (
        <ReviewStep
          state={state}
          prevStep={prevStep}
          submitBooking={submitBooking}
          pricingLabel={pricing?.label ?? null}
        />
      )}

      {state.step === 'submitted' && <SubmittedStep />}
    </div>
  );
}
