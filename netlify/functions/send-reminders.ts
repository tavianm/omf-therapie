/**
 * Netlify Scheduled Function — Rappels J-1
 *
 * S'exécute chaque jour à 08h00 UTC (= 09h00 / 10h00 Paris selon DST).
 * Envoie un email de rappel aux patients dont le rendez-vous est planifié
 * pour le lendemain en heure de Paris.
 *
 * ⚠️  Dépendances requises (à ajouter dans package.json) :
 *   "@netlify/functions"     — présent en node_modules (dép. transitive @astrojs/netlify)
 *                              mais absent de package.json → à déclarer en dépendance directe
 *   "@supabase/supabase-js"  — non installé ; requis pour accéder à la DB
 *   "resend"                 — non installé ; requis pour envoyer les emails
 *   "@react-email/components"— non installé ; requis par AppointmentReminder.tsx
 *   "react"                  — déjà installé ✓
 *
 * ⚠️  Variables d'environnement (process.env, pas import.meta.env) :
 *   SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL
 *
 * Note : ce fichier s'exécute dans le runtime Node.js de Netlify, pas dans Vite.
 * Les helpers src/lib/supabase.ts et src/lib/resend.ts utilisent import.meta.env
 * et ne peuvent pas être importés ici. Les clients sont instanciés localement.
 */

import type { Config } from '@netlify/functions';
import { createElement } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import ws from 'ws';
import AppointmentReminder from '../../src/emails/AppointmentReminder';
import PaymentReminder from '../../src/emails/PaymentReminder';
import type { Appointment } from '../../src/types/appointment';

// ---------------------------------------------------------------------------
// Calcul de la fenêtre "demain en heure de Paris"
// ---------------------------------------------------------------------------

/**
 * Retourne les timestamps UTC correspondant à
 * demain 00:00:00.000 Paris → demain 23:59:59.999 Paris.
 */
function getParisTomorrowWindow(): { windowStart: Date; windowEnd: Date } {
  const now = new Date();

  // Date de "demain" du point de vue du fuseau Paris
  // (en-CA donne le format ISO YYYY-MM-DD)
  const tomorrowInParis = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDateStr = tomorrowInParis.toLocaleDateString('en-CA', {
    timeZone: 'Europe/Paris',
  }); // ex. '2025-07-17'

  // Minuit UTC de cette date-là (référence pour calculer l'offset Paris)
  const [y, m, d] = tomorrowDateStr.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));

  // Heure Paris à cet instant UTC (pour déduire l'offset UTC+1 ou UTC+2)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(utcMidnight);

  const parisHour   = parseInt(parts.find((p) => p.type === 'hour')!.value,   10) % 24;
  const parisMinute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  const parisOffsetMs = (parisHour * 60 + parisMinute) * 60_000;

  // Minuit Paris (UTC) = minuit UTC de cette date − offset Paris
  const windowStart = new Date(utcMidnight.getTime() - parisOffsetMs);
  // 23h59:59.999 Paris = windowStart + 24 h − 1 ms
  const windowEnd   = new Date(windowStart.getTime() + 86_400_000 - 1);

  return { windowStart, windowEnd };
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(): Promise<void> {
  // 1. Initialiser les clients (process.env — runtime Node.js Netlify)
  const supabaseUrl             = process.env.SUPABASE_DATABASE_URL;
  const supabaseServiceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey            = process.env.RESEND_API_KEY;
  const fromEmail               = process.env.RESEND_FROM_EMAIL ?? 'OMF Thérapie <contact@omf-therapie.fr>';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[send-reminders] SUPABASE_DATABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant — abandon.');
    return;
  }

  if (!resendApiKey) {
    console.error('[send-reminders] RESEND_API_KEY manquante — abandon.');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAdmin = createClient<any>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const resendClient = new Resend(resendApiKey);

  // 2. Calculer la fenêtre temporelle
  const { windowStart, windowEnd } = getParisTomorrowWindow();

  console.info(
    `[send-reminders] Fenêtre : ${windowStart.toISOString()} → ${windowEnd.toISOString()}`,
  );

  // 3. Requêter les rendez-vous de demain confirmés ou payés
  const { data: appointments, error: fetchError } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .gte('scheduled_at', windowStart.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
    .in('status', ['confirmed', 'payment_received'])
    .is('reminder_sent_at', null)
    .is('deleted_at', null);

  if (fetchError) {
    console.error('[send-reminders] Erreur Supabase :', fetchError.message);
    return;
  }

  // 3b. Requêter les rendez-vous de demain en attente de paiement
  const { data: pendingPayments, error: pendingError } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .gte('scheduled_at', windowStart.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
    .eq('status', 'payment_pending')
    .is('reminder_sent_at', null)
    .is('deleted_at', null);

  if (pendingError) {
    console.error('[send-reminders] Erreur Supabase (payment_pending) :', pendingError.message);
    return;
  }

  const list = (appointments ?? []) as Appointment[];
  const paymentList = (pendingPayments ?? []) as Appointment[];

  console.info(`[send-reminders] ${list.length} rappel(s) J-1 à envoyer.`);
  console.info(`[send-reminders] ${paymentList.length} rappel(s) paiement en attente à envoyer.`);

  if (list.length === 0 && paymentList.length === 0) {
    return;
  }

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour:     '2-digit',
      minute:   '2-digit',
    }).format(new Date(iso));

  // 4. Envoyer un email de rappel J-1 à chaque patient confirmé / ayant payé
  let sent = 0;
  let failed = 0;

  for (const appt of list) {
    try {
      const { error } = await resendClient.emails.send({
        from: fromEmail,
        to:   [appt.patient_email],
        subject: `Rappel : votre rendez-vous demain à ${formatTime(appt.scheduled_at)}`,
        react: createElement(AppointmentReminder, {
          patientName:     appt.patient_name,
          appointmentMode: appt.appointment_mode,
          scheduledAt:     appt.scheduled_at,
          duration:        appt.duration,
          videoLink:       appt.video_link   ?? undefined,
          cabinetAddress:  undefined, // valeur par défaut dans le template
        }),
      });

      if (error) {
        console.error(
          `[send-reminders] Échec rappel pour ${appt.patient_email} (id: ${appt.id}) :`,
          error.message,
        );
        failed++;
      } else {
        sent++;
        await supabaseAdmin
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[send-reminders] Exception pour ${appt.patient_email} (id: ${appt.id}) :`,
        msg,
      );
      failed++;
      // On continue avec le prochain rendez-vous
    }
  }

  // 5. Envoyer un rappel de paiement aux rendez-vous en attente de règlement
  let sentPayment = 0;
  let failedPayment = 0;

  for (const appt of paymentList) {
    if (!appt.stripe_payment_link_url) {
      console.warn(
        `[send-reminders] stripe_payment_link_url manquant pour ${appt.patient_email} (id: ${appt.id}) — rappel paiement ignoré.`,
      );
      continue;
    }

    try {
      const { error } = await resendClient.emails.send({
        from: fromEmail,
        to:   [appt.patient_email],
        subject: `⚠️ Action requise : réglez votre séance de demain à ${formatTime(appt.scheduled_at)}`,
        react: createElement(PaymentReminder, {
          patientName:      appt.patient_name,
          appointmentType:  appt.appointment_type,
          scheduledAt:      appt.scheduled_at,
          duration:         appt.duration,
          finalPrice:       appt.final_price,
          stripePaymentUrl: appt.stripe_payment_link_url,
        }),
      });

      if (error) {
        console.error(
          `[send-reminders] Échec rappel paiement pour ${appt.patient_email} (id: ${appt.id}) :`,
          error.message,
        );
        failedPayment++;
      } else {
        sentPayment++;
        await supabaseAdmin
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[send-reminders] Exception paiement pour ${appt.patient_email} (id: ${appt.id}) :`,
        msg,
      );
      failedPayment++;
    }
  }

  console.info(
    `[send-reminders] Terminé — rappels J-1 : ${sent} envoyé(s), ${failed} échoué(s) | rappels paiement : ${sentPayment} envoyé(s), ${failedPayment} échoué(s).`,
  );
}

// ---------------------------------------------------------------------------
// Configuration Netlify : planification CRON
// ---------------------------------------------------------------------------

export const config: Config = {
  /** Chaque jour à 08h00 UTC (= 09h00 hiver / 10h00 été Paris) */
  schedule: '0 8 * * *',
};
