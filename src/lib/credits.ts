/**
 * credits.ts — gestion de l'avoir interne (ledger) — OMF Thérapie
 *
 * Source unique de vérité pour la lecture, l'émission, la consommation et la
 * restitution des avoirs. Aucune autre couche ne doit écrire directement dans
 * `credits` / `credit_usages` : les handlers API passent par ce module.
 *
 * Montants en centimes (cohérent avec `appointments.final_price`).
 *
 * Concurrency : la consommation FIFO est atomique via la RPC Postgres
 * `consume_credits` (SECURITY DEFINER) ; la restitution via `restore_credits`.
 * L'émission et la lecture sont en JS pur (pas de concurrency critique côté
 * émetteur — l'idempotence est garantie par l'index UNIQUE(source_appointment_id)).
 */

import { supabaseAdmin } from './supabase';
import type { Appointment } from '../types/appointment';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditRow {
  id: string;
  patient_email: string;
  source_appointment_id: string | null;
  amount: number;
  remaining: number;
  reason: string;
  created_at: string;
  updated_at: string;
}

export interface CreditUsage {
  credit_id: string;
  amount: number;
}

export interface CreditBalance {
  balance: number;
  history: CreditRow[];
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/**
 * Solde d'avoir disponible (centimes) pour un patient, via son email.
 * Normalisation : lowercase (cohérent avec l'insertion des appointments).
 */
export async function getAvailableCredit(patientEmail: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('credits')
    .select('remaining')
    .eq('patient_email', patientEmail.toLowerCase())
    .gt('remaining', 0);

  if (error) {
    console.error('[credits] getAvailableCredit error:', error);
    return 0;
  }
  return (data ?? []).reduce((sum, r) => sum + (r.remaining as number), 0);
}

/**
 * Solde + historique complet d'un patient (pour la page admin / affichage).
 */
export async function getCreditBalance(patientEmail: string): Promise<CreditBalance> {
  const { data, error } = await supabaseAdmin
    .from('credits')
    .select('*')
    .eq('patient_email', patientEmail.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[credits] getCreditBalance error:', error);
    return { balance: 0, history: [] };
  }
  const history = (data ?? []) as unknown as CreditRow[];
  const balance = history.reduce((sum, c) => sum + c.remaining, 0);
  return { balance, history };
}

// ---------------------------------------------------------------------------
// Émission (annulation d'un RDV payé)
// ---------------------------------------------------------------------------

/**
 * Émet un avoir pour l'annulation d'un RDV.
 *
 * Idempotent : si un avoir existe déjà pour ce RDV source (index UNIQUE),
 * l'insertion est ignorée et l'avoir existant est retourné. Permet de tolérer
 * un re-clic sur « Annuler » ou une retry.
 *
 * @param appt       RDV annulé (doit être `payment_received`).
 * @param amountCash Cash réellement encaissé via Stripe = final_price − credit_applied.
 *                   Doit être > 0 (l'appelant ne doit pas appeler si 0).
 */
export async function issueCreditForCancellation(
  appt: Pick<Appointment, 'id' | 'patient_email' | 'final_price' | 'credit_applied'>,
  amountCash: number,
): Promise<CreditRow | null> {
  if (amountCash <= 0) return null;

  const { data, error } = await supabaseAdmin
    .from('credits')
    .insert({
      patient_email: appt.patient_email.toLowerCase(),
      source_appointment_id: appt.id,
      amount: amountCash,
      remaining: amountCash,
      reason: 'cancellation',
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation → avoir déjà émis pour ce RDV (idempotence).
    // On retourne l'avoir existant plutôt qu'une erreur.
    if (error.code === '23505') {
      const { data: existing } = await supabaseAdmin
        .from('credits')
        .select('*')
        .eq('source_appointment_id', appt.id)
        .maybeSingle();
      return (existing as unknown as CreditRow) ?? null;
    }
    console.error('[credits] issueCreditForCancellation error:', error);
    throw new Error(`Erreur émission avoir: ${error.message}`);
  }
  return data as unknown as CreditRow;
}

// ---------------------------------------------------------------------------
// Consommation (création manuelle avec avoir) — RPC atomique FIFO
// ---------------------------------------------------------------------------

/**
 * Consomme `amount` centimes d'avoir pour un RDV, en FIFO (avoirs les plus
 * anciens d'abord). Atomicité garantie par la RPC Postgres `consume_credits`.
 *
 * @returns les tranches consommées (audit). Lève en cas d'avoir insuffisant
 *          (la RPC RAISE CREDIT_INSUFFICIENT → remontée comme erreur).
 */
export async function consumeCredits(
  patientEmail: string,
  amount: number,
  appointmentId: string,
): Promise<CreditUsage[]> {
  if (amount <= 0) return [];

  const { data, error } = await supabaseAdmin.rpc('consume_credits', {
    p_email: patientEmail.toLowerCase(),
    p_amount: amount,
    p_appointment_id: appointmentId,
  });

  if (error) {
    console.error('[credits] consumeCredits error:', error);
    throw new Error(`Erreur consommation avoir: ${error.message}`);
  }
  return (data ?? []) as unknown as CreditUsage[];
}

// ---------------------------------------------------------------------------
// Restitution (annulation d'un RDV qui avait consommé un avoir)
// ---------------------------------------------------------------------------

/**
 * Restitue l'avoir consommé par un RDV (restaure les `remaining` sources et
 * supprime les `credit_usages`). Idempotent (no-op si déjà restitué).
 *
 * À appeler systématiquement quand on annule un RDV avec `credit_applied > 0`,
 * AVANT l'éventuelle émission d'un nouvel avoir.
 */
export async function restoreCredits(appointmentId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('restore_credits', {
    p_appointment_id: appointmentId,
  });
  if (error) {
    console.error('[credits] restoreCredits error:', error);
    throw new Error(`Erreur restitution avoir: ${error.message}`);
  }
}
