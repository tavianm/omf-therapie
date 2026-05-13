/**
 * useBooking — hook React gérant l'état du formulaire de réservation multi-étapes.
 *
 * Wizard : 'type-mode' → 'datetime' → 'patient-info' → 'review' → 'submitted'
 */

import { useCallback, useMemo, useState } from 'react';
import { calculatePrice } from '../lib/pricing';
import type { PricingResult } from '../lib/pricing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BookingStep =
  | 'type-mode'
  | 'datetime'
  | 'patient-info'
  | 'review'
  | 'submitted';

export interface BookingState {
  step: BookingStep;

  // Étape 1 — Type & Mode
  appointment_type: 'individual' | 'couple' | 'family' | null;
  appointment_mode: 'in-person' | 'video' | null;
  duration: 60 | 90 | null;
  is_first_session: boolean;

  // Étape 2 — Créneau
  scheduled_at: string | null; // ISO string du créneau sélectionné

  // Étape 3 — Infos patient
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  patient_postal_code: string;
  patient_city: string;
  patient_reason: string;

  // UI
  isSubmitting: boolean;
  submitError: string | null;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const INITIAL_STATE: BookingState = {
  step: 'type-mode',

  appointment_type: null,
  appointment_mode: null,
  duration: null,
  is_first_session: false,

  scheduled_at: null,

  patient_name: '',
  patient_email: '',
  patient_phone: '',
  patient_postal_code: '',
  patient_city: '',
  patient_reason: '',

  isSubmitting: false,
  submitError: null,
};

const STEP_ORDER: BookingStep[] = [
  'type-mode',
  'datetime',
  'patient-info',
  'review',
  'submitted',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Même regex que le validateur côté serveur (src/pages/api/appointments/index.ts)
const PHONE_RE = /^(?:\+33|0033|0)[1-9](?:[0-9]{8})$/;
const POSTAL_RE = /^[0-9]{5}$/;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBooking() {
  const [state, setState] = useState<BookingState>(INITIAL_STATE);

  // ── Navigation ────────────────────────────────────────────────────────────

  const setStep = useCallback((step: BookingStep) => {
    setState(prev => ({ ...prev, step, submitError: null }));
  }, []);

  // ── Mise à jour champ ─────────────────────────────────────────────────────

  const updateField = useCallback(<K extends keyof BookingState>(
    field: K,
    value: BookingState[K],
  ) => {
    setState(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Validation par étape ──────────────────────────────────────────────────

  const isStepValid = useCallback((step: BookingStep): boolean => {
    switch (step) {
      case 'type-mode':
        return (
          state.appointment_type !== null &&
          state.appointment_mode !== null &&
          state.duration !== null
        );

      case 'datetime':
        return state.scheduled_at !== null;

      case 'patient-info': {
        const phoneClean = state.patient_phone.replace(/\s/g, '');
        return (
          state.patient_name.trim().length >= 2 &&
          state.patient_name.trim().length <= 100 &&
          EMAIL_RE.test(state.patient_email) &&
          PHONE_RE.test(phoneClean) &&
          POSTAL_RE.test(state.patient_postal_code) &&
          state.patient_city.trim().length >= 2 &&
          state.patient_reason.trim().length >= 10 &&
          state.patient_reason.trim().length <= 1500
        );
      }

      case 'review':
      case 'submitted':
        return true;
    }
  }, [state]);

  // ── Avancer ───────────────────────────────────────────────────────────────

  const nextStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    if (currentIndex >= 0 && currentIndex < STEP_ORDER.length - 1) {
      if (isStepValid(state.step)) {
        setStep(STEP_ORDER[currentIndex + 1]);
      }
    }
  }, [state.step, isStepValid, setStep]);

  // ── Reculer ───────────────────────────────────────────────────────────────

  const prevStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    if (currentIndex > 0) {
      setStep(STEP_ORDER[currentIndex - 1]);
    }
  }, [state.step, setStep]);

  // ── Soumission ────────────────────────────────────────────────────────────

  const submitBooking = useCallback(async () => {
    setState(prev => ({ ...prev, isSubmitting: true, submitError: null }));

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: state.patient_name.trim(),
          patient_email: state.patient_email.trim().toLowerCase(),
          patient_phone: state.patient_phone.replace(/\s/g, ''),
          patient_postal_code: state.patient_postal_code,
          patient_city: state.patient_city.trim(),
          patient_reason: state.patient_reason.trim(),
          appointment_type: state.appointment_type,
          appointment_mode: state.appointment_mode,
          duration: state.duration,
          is_first_session: state.is_first_session,
          scheduled_at: state.scheduled_at,
        }),
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? 'Une erreur est survenue lors de l\'envoi.');
      }

      setState(prev => ({ ...prev, step: 'submitted', isSubmitting: false }));
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message
        : 'Une erreur inattendue est survenue.';
      setState(prev => ({ ...prev, isSubmitting: false, submitError: message }));
    }
  }, [state]);

  // ── Tarif calculé en temps réel ───────────────────────────────────────────

  const pricing: PricingResult | null = useMemo(() => {
    if (!state.appointment_type || !state.duration) return null;
    return calculatePrice(
      state.appointment_type,
      state.duration,
      state.is_first_session,
    );
  }, [state.appointment_type, state.duration, state.is_first_session]);

  // ── API publique ──────────────────────────────────────────────────────────

  return {
    state,
    setStep,
    updateField,
    nextStep,
    prevStep,
    submitBooking,
    pricing,
    isStepValid,
  };
}
