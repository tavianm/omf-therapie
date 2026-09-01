import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { calculatePrice } from '../../utils/pricing';
import type {
  Appointment,
  AppointmentMode,
  AppointmentType,
} from '../../types/appointment';
import type { Patient } from '../../types/patient';
import {
  EXPOSED_CUSTOM_DURATIONS,
  isCustomDurationValid,
  requiresManualPrice,
} from './admin-composer-utils';

interface AppointmentComposerProps {
  initialPatient?: Patient | null;
  onCreated: (appointment: Appointment) => void;
  onClose: () => void;
}

interface FormState {
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  appointment_type: AppointmentType;
  appointment_mode: AppointmentMode;
  duration: number;
  scheduled_at: string;
  patient_reason: string;
  override_first_session: boolean;
  is_solidarity: boolean;
  send_email: boolean;
  video_link: string;
  use_credit: boolean;
  override_price: string;
}

const EMPTY_FORM: FormState = {
  patient_name: '',
  patient_email: '',
  patient_phone: '',
  appointment_type: 'individual',
  appointment_mode: 'in-person',
  duration: 60,
  scheduled_at: '',
  patient_reason: '',
  override_first_session: false,
  is_solidarity: false,
  send_email: true,
  video_link: '',
  use_credit: false,
  override_price: '',
};

// eslint-disable-next-line react-refresh/only-export-components
export function formForPatient(patient?: Patient | null): FormState {
  if (!patient) return EMPTY_FORM;
  return {
    ...EMPTY_FORM,
    patient_name: patient.name,
    patient_email: patient.email,
    patient_phone: patient.phone,
    appointment_type: patient.lastAppointmentType,
    appointment_mode: patient.lastAppointmentMode,
  };
}

function formatSlot(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

/**
 * Value for a datetime-local input from a slot instant. These inputs carry no
 * timezone and the submit path re-parses them in the device timezone (Paris
 * for the practitioner), so the instant must be rendered in Europe/Paris wall
 * time — toISOString() would shift the appointment 1–2 h early.
 */
function toDatetimeLocal(iso: string): string {
  // sv-SE formats as YYYY-MM-DD HH:mm — one replace away from the input format.
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  })
    .format(new Date(iso))
    .replace(' ', 'T');
}

export function AppointmentComposer({
  initialPatient,
  onCreated,
  onClose,
}: AppointmentComposerProps) {
  const [form, setForm] = useState<FormState>(() =>
    formForPatient(initialPatient),
  );
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [usesCustomDuration, setUsesCustomDuration] = useState(false);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const patientNameInputRef = useRef<HTMLInputElement>(null);

  const matchingPatients = useMemo(() => {
    const query = form.patient_name.trim().toLocaleLowerCase('fr-FR');
    if (query.length < 2) return [];
    return patients
      .filter(patient =>
        `${patient.name} ${patient.email} ${patient.phone}`
          .toLocaleLowerCase('fr-FR')
          .includes(query),
      )
      .slice(0, 5);
  }, [form.patient_name, patients]);

  const price = useMemo(() => {
    if (requiresManualPrice(form.duration) && !form.override_price) {
      return { finalPrice: 0, label: 'Tarif manuel requis' };
    }
    return calculatePrice(
      form.appointment_type,
      form.duration,
      form.override_first_session,
      form.is_solidarity,
      form.override_price ? Number(form.override_price) : undefined,
    );
  }, [form]);

  useEffect(() => {
    fetch('/api/admin/patients/?includeArchived=true', {
      credentials: 'same-origin',
    })
      .then(response =>
        response.ok
          ? (response.json() as Promise<{ patients?: Patient[] }>)
          : null,
      )
      .then(data => setPatients(data?.patients ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (requiresManualPrice(form.duration)) {
      setSlots([]);
      setLoadingSlots(false);
      return;
    }
    const controller = new AbortController();
    setLoadingSlots(true);
    fetch(
      `/api/availability/?mode=${form.appointment_mode}&duration=${form.duration}&weeks=4`,
      {
        signal: controller.signal,
      },
    )
      .then(response =>
        response.ok
          ? (response.json() as Promise<{ slots?: Array<{ start: string }> }>)
          : null,
      )
      .then(data =>
        setSlots((data?.slots ?? []).slice(0, 8).map(slot => slot.start)),
      )
      .catch(() => {
        if (!controller.signal.aborted) setSlots([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSlots(false);
      });
    return () => controller.abort();
  }, [form.appointment_mode, form.duration]);

  function update<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm(current => ({ ...current, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  function selectPatient(patient: Patient) {
    setForm(current => ({
      ...current,
      patient_name: patient.name,
      patient_email: patient.email,
      patient_phone: patient.phone,
      appointment_type: patient.lastAppointmentType,
      appointment_mode: patient.lastAppointmentMode,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCustomDurationValid(form.duration)) {
      setError(
        'La durée personnalisée doit être comprise entre 15 et 240 minutes.',
      );
      return;
    }
    if (requiresManualPrice(form.duration) && !form.override_price) {
      setError('Un tarif manuel est requis pour cette durée personnalisée.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { override_price, ...appointmentForm } = form;
      const response = await fetch('/api/admin/appointments/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...appointmentForm,
          scheduled_at: new Date(form.scheduled_at).toISOString(),
          ...(override_price ? { override_price: Number(override_price) } : {}),
        }),
      });
      const payload = (await response.json()) as {
        appointment?: Appointment;
        error?: string;
      };
      if (!response.ok || !payload.appointment)
        throw new Error(payload.error ?? 'La création a échoué.');
      onCreated(payload.appointment);
      setSuccess(
        `Rendez-vous créé pour ${payload.appointment.patient_name}. Vous pouvez créer le suivant.`,
      );
      setForm(EMPTY_FORM);
      setUsesCustomDuration(false);
      setShowAdvanced(false);
      requestAnimationFrame(() => {
        patientNameInputRef.current?.focus();
        patientNameInputRef.current?.scrollIntoView({ block: 'nearest' });
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erreur inconnue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <p className="text-sm text-sage-600">
        Un seul rendez-vous est créé à chaque validation. Le formulaire reste
        ouvert pour le patient suivant.
      </p>
      {success && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border border-mint-200 bg-mint-50 p-3 text-sm text-mint-900"
        >
          {success}
        </p>
      )}
      <fieldset className="space-y-3">
        <legend className="font-semibold text-sage-900">1. Patient</legend>
        <label className="block text-sm text-sage-700">
          Nom
          <input
            ref={patientNameInputRef}
            required
            value={form.patient_name}
            onChange={event => update('patient_name', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3 focus:outline-none focus:ring-2 focus:ring-mint-400"
          />
        </label>
        {matchingPatients.length > 0 && (
          <ul className="rounded-xl border border-sage-200 bg-sage-50 p-1">
            {matchingPatients.map(patient => (
              <li key={patient.email}>
                <button
                  type="button"
                  onClick={() => selectPatient(patient)}
                  className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-white"
                >
                  Utiliser {patient.name} · {patient.email}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="block text-sm text-sage-700">
          Email
          <input
            required
            type="email"
            value={form.patient_email}
            onChange={event => update('patient_email', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3 focus:outline-none focus:ring-2 focus:ring-mint-400"
          />
        </label>
        <label className="block text-sm text-sage-700">
          Téléphone
          <input
            value={form.patient_phone}
            onChange={event => update('patient_phone', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3 focus:outline-none focus:ring-2 focus:ring-mint-400"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold text-sage-900">2. Séance</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-sage-700">
            Type
            <select
              value={form.appointment_type}
              onChange={event =>
                update(
                  'appointment_type',
                  event.target.value as AppointmentType,
                )
              }
              className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
            >
              <option value="individual">Individuelle</option>
              <option value="couple">Couple</option>
              <option value="family">Familiale</option>
            </select>
          </label>
          <label className="text-sm text-sage-700">
            Mode
            <select
              value={form.appointment_mode}
              onChange={event =>
                update(
                  'appointment_mode',
                  event.target.value as AppointmentMode,
                )
              }
              className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
            >
              <option value="in-person">Présentiel</option>
              <option value="video">Téléconsultation</option>
            </select>
          </label>
        </div>
        <label className="block text-sm text-sage-700">
          Durée
          <select
            value={usesCustomDuration ? 'custom' : form.duration}
            onChange={event => {
              if (event.target.value === 'custom') {
                setUsesCustomDuration(true);
                update(
                  'duration',
                  requiresManualPrice(form.duration) ? form.duration : 45,
                );
                return;
              }
              setUsesCustomDuration(false);
              update('duration', Number(event.target.value));
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
          >
            <option value={60}>60 minutes</option>
            <option value={90}>90 minutes</option>
            {EXPOSED_CUSTOM_DURATIONS.map(duration => (
              <option key={duration} value={duration}>
                {duration} minutes (tarif manuel)
              </option>
            ))}
            <option value="custom">Personnalisée…</option>
          </select>
        </label>
        {usesCustomDuration && (
          <label className="block text-sm text-sage-700">
            Durée personnalisée (15 à 240 minutes)
            <input
              required
              type="number"
              min="15"
              max="240"
              step="1"
              value={form.duration}
              onChange={event => update('duration', Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
            />
          </label>
        )}
      </fieldset>

      {requiresManualPrice(form.duration) && (
        <label className="block text-sm text-sage-700">
          Tarif manuel (€)
          <input
            required
            type="number"
            min="0"
            max="500"
            value={form.override_price}
            onChange={event => update('override_price', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
          />
        </label>
      )}

      <fieldset className="space-y-3">
        <legend className="font-semibold text-sage-900">3. Créneau</legend>
        <div className="flex flex-wrap gap-2">
          {slots.map(slot => (
            <button
              key={slot}
              type="button"
              onClick={() => update('scheduled_at', toDatetimeLocal(slot))}
              className={`min-h-11 rounded-xl border px-3 text-sm ${form.scheduled_at === toDatetimeLocal(slot) ? 'border-mint-700 bg-mint-50 text-mint-900' : 'border-sage-200 text-sage-700'}`}
            >
              {formatSlot(slot)}
            </button>
          ))}
          {loadingSlots && (
            <span className="text-sm text-sage-500">
              Chargement des créneaux…
            </span>
          )}
        </div>
        <label className="block text-sm text-sage-700">
          Créneau exceptionnel
          <input
            required
            type="datetime-local"
            value={form.scheduled_at}
            onChange={event => update('scheduled_at', event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3 focus:outline-none focus:ring-2 focus:ring-mint-400"
          />
        </label>
      </fieldset>

      <button
        type="button"
        onClick={() => setShowAdvanced(current => !current)}
        aria-expanded={showAdvanced}
        className="min-h-11 text-sm font-medium text-mint-800 underline"
      >
        {showAdvanced
          ? 'Masquer les options avancées'
          : 'Afficher les options avancées'}
      </button>
      {showAdvanced && (
        <fieldset className="space-y-3 rounded-xl border border-sage-200 bg-sage-50 p-3">
          <legend className="px-1 font-semibold text-sage-900">
            Options avancées
          </legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-sage-700">
            <input
              type="checkbox"
              checked={form.override_first_session}
              onChange={event =>
                update('override_first_session', event.target.checked)
              }
            />{' '}
            Première séance
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-sage-700">
            <input
              type="checkbox"
              checked={form.is_solidarity}
              onChange={event => update('is_solidarity', event.target.checked)}
            />{' '}
            Tarif solidaire
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-sage-700">
            <input
              type="checkbox"
              checked={form.use_credit}
              onChange={event => update('use_credit', event.target.checked)}
            />{' '}
            Utiliser un avoir
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-sage-700">
            <input
              type="checkbox"
              checked={form.send_email}
              onChange={event => update('send_email', event.target.checked)}
            />{' '}
            Envoyer l’email
          </label>
          {form.appointment_mode === 'video' && (
            <label className="block text-sm text-sage-700">
              Lien vidéo
              <input
                type="url"
                value={form.video_link}
                onChange={event => update('video_link', event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
              />
            </label>
          )}
          {!requiresManualPrice(form.duration) && (
            <label className="block text-sm text-sage-700">
              Tarif manuel (€)
              <input
                type="number"
                min="0"
                max="500"
                value={form.override_price}
                onChange={event => update('override_price', event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-sage-200 px-3"
              />
            </label>
          )}
        </fieldset>
      )}

      <label className="block text-sm text-sage-700">
        Motif (optionnel)
        <textarea
          value={form.patient_reason}
          onChange={event => update('patient_reason', event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-sage-200 p-3 focus:outline-none focus:ring-2 focus:ring-mint-400"
        />
      </label>
      <p className="rounded-xl bg-sage-50 p-3 text-sm text-sage-700">
        Tarif estimé : {price.finalPrice} €
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="min-h-11 flex-1 rounded-xl border border-sage-300 text-sm font-medium text-sage-700"
        >
          Terminer
        </button>
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 flex-1 rounded-xl bg-mint-700 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Création…' : 'Créer ce rendez-vous'}
        </button>
      </div>
    </form>
  );
}
