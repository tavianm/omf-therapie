/**
 * Netlify Scheduled Function — Rappels J-1
 *
 * S'exécute chaque jour à 18h00 UTC (= 19h00 / 20h00 heure de Paris selon DST).
 * Envoie un email de rappel aux patients dont le rendez-vous est planifié
 * pour le lendemain en heure de Paris.
 *
 * Observabilité : enveloppé par Sentry.withMonitor (détection de non-exécution
 * — Netlify scheduler n'a pas d'alerting natif). La const SCHEDULE est partagée
 * entre la config Netlify et le monitor Sentry pour éviter toute dérive.
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
 *   SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL,
 *   PUBLIC_SENTRY_DSN (optionnel — instrumentation Sentry)
 *
 * Note : ce fichier s'exécute dans le runtime Node.js de Netlify, pas dans Vite.
 * Les helpers src/lib/supabase.ts et src/lib/resend.ts utilisent import.meta.env
 * et ne peuvent pas être importés ici. Les clients sont instanciés localement.
 */

import type { Config } from '@netlify/functions';
import * as Sentry from '@sentry/node';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { Resend } from 'resend';
import ws from 'ws';
import AppointmentReminder from '../../src/emails/AppointmentReminder';
import PaymentReminder from '../../src/emails/PaymentReminder';
import type { Appointment } from '../../src/types/appointment';
import { initSentry, captureAndFlush } from './_lib/sentry';
import { logger } from './_lib/logger';

/** Schedule partagée entre la config Netlify et le monitor Sentry. */
const SCHEDULE = '0 18 * * *' as const;

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

  const parisHour =
    parseInt(parts.find((p) => p.type === 'hour')!.value, 10) % 24;
  const parisMinute = parseInt(
    parts.find((p) => p.type === 'minute')!.value,
    10,
  );
  const parisOffsetMs = (parisHour * 60 + parisMinute) * 60_000;

  // Minuit Paris (UTC) = minuit UTC de cette date − offset Paris
  const windowStart = new Date(utcMidnight.getTime() - parisOffsetMs);
  // 23h59:59.999 Paris = windowStart + 24 h − 1 ms
  const windowEnd = new Date(windowStart.getTime() + 86_400_000 - 1);

  return { windowStart, windowEnd };
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Handler body. Wrapped by Sentry.withMonitor on export so missed executions
 * surface as a Sentry monitor alert (Netlify's scheduler has no native
 * alerting). The shared SCHEDULE const guarantees the monitor's expected
 * cadence matches Netlify's actual trigger.
 */
async function runSendReminders(): Promise<void> {
  // initSentry() now runs in handler() BEFORE withMonitor — see comment above.
  try {
    await sendReminders();
  } catch (err) {
    // Flush before the function returns: Lambda/Netlify freezes the execution
    // environment on return, dropping any in-flight Sentry events.
    await captureAndFlush(err);
    throw err;
  } finally {
    if (process.env.PUBLIC_SENTRY_DSN) {
      await Sentry.flush(2000);
    }
  }
}

// Sentry.withMonitor wraps the work so missed runs (no check-in within
// checkInMargin minutes of the schedule) raise a Sentry alert. checkInMargin
// and maxRuntime are in minutes.
//
// CRITICAL: `withMonitor(slug, callback, opts)` returns `T` (the callback's
// return value), NOT a function. Exporting it directly breaks Netlify's
// bootstrap, which calls `handler(event, context)` — the resulting
// `handler is not a function` TypeError silently fails every scheduled run.
// We must wrap it in a real handler function that Netlify can invoke.
//
// CRITICAL #2 (regression #113): `initSentry()` MUST run BEFORE
// `Sentry.withMonitor()`. `withMonitor` emits an `in_progress` check-in at
// entry, and THAT check-in is the only one carrying the `monitor_config`
// (with `checkInMargin`). If the client isn't initialized yet, the envelope
// is dropped → Sentry never receives the margin → `checkin_margin: null` →
// missed-run detection uses the (tighter) default. initSentry() is idempotent
// (guarded by `initialized`) so calling it here makes the call inside
// runSendReminders() below a harmless no-op.
async function handler(): Promise<void> {
  initSentry();
  return Sentry.withMonitor(
    'send-reminders',
    runSendReminders,
    {
      schedule: { type: 'crontab', value: SCHEDULE },
      checkInMargin: 5,
      maxRuntime: 10,
    },
  );
}

export default handler;

async function sendReminders(): Promise<void> {
  // 1. Initialiser les clients (process.env — runtime Node.js Netlify)
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? 'OMF Thérapie <contact@omf-therapie.fr>';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    logger.error('send-reminders: SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — aborting');
    return;
  }

  if (!resendApiKey) {
    logger.error('send-reminders: RESEND_API_KEY missing — aborting');
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

  logger.info('send-reminders: window', {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  });

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
    logger.error('send-reminders: Supabase query failed (confirmed/payment_received)', {}, fetchError);
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
    logger.error('send-reminders: Supabase query failed (payment_pending)', {}, pendingError);
    return;
  }

  const list = (appointments ?? []) as Appointment[];
  const paymentList = (pendingPayments ?? []) as Appointment[];

  logger.info('send-reminders: queue sizes', { dayMinusOne: list.length, paymentPending: paymentList.length });

  if (list.length === 0 && paymentList.length === 0) {
    return;
  }

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  // 4. Envoyer un email de rappel J-1 à chaque patient confirmé / ayant payé
  let sent = 0;
  let failed = 0;

  for (const appt of list) {
    try {
      const { error } = await resendClient.emails.send({
        from: fromEmail,
        to: [appt.patient_email],
        subject: `Rappel : votre rendez-vous demain à ${formatTime(appt.scheduled_at)}`,
        react: createElement(AppointmentReminder, {
          patientName: appt.patient_name,
          appointmentMode: appt.appointment_mode,
          scheduledAt: appt.scheduled_at,
          duration: appt.duration,
          videoLink: appt.video_link ?? undefined,
          cabinetAddress: undefined, // valeur par défaut dans le template
        }),
      });

      if (error) {
        logger.error('send-reminders: reminder send failed (confirmed/payment_received)', { appointmentId: appt.id }, error);
        failed++;
      } else {
        sent++;
        await supabaseAdmin
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id);
      }
    } catch (err: unknown) {
      logger.error('send-reminders: reminder send threw (confirmed/payment_received)', { appointmentId: appt.id }, err);
      failed++;
      // On continue avec le prochain rendez-vous
    }
  }

  // 5. Envoyer un rappel de paiement aux rendez-vous en attente de règlement
  let sentPayment = 0;
  let failedPayment = 0;

  for (const appt of paymentList) {
    if (!appt.stripe_payment_link_url) {
      logger.warn('send-reminders: stripe_payment_link_url missing, payment reminder skipped', { appointmentId: appt.id });
      continue;
    }

    try {
      const { error } = await resendClient.emails.send({
        from: fromEmail,
        to: [appt.patient_email],
        subject: `⚠️ Action requise : réglez votre séance de demain à ${formatTime(appt.scheduled_at)}`,
        react: createElement(PaymentReminder, {
          patientName: appt.patient_name,
          appointmentType: appt.appointment_type,
          scheduledAt: appt.scheduled_at,
          duration: appt.duration,
          finalPrice: appt.final_price,
          stripePaymentUrl: appt.stripe_payment_link_url,
        }),
      });

      if (error) {
        logger.error('send-reminders: payment reminder send failed', { appointmentId: appt.id }, error);
        failedPayment++;
      } else {
        sentPayment++;
        await supabaseAdmin
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id);
      }
    } catch (err: unknown) {
      logger.error('send-reminders: payment reminder send threw', { appointmentId: appt.id }, err);
      failedPayment++;
    }
  }

  logger.info('send-reminders: done', { dayMinusOneSent: sent, dayMinusOneFailed: failed, paymentSent: sentPayment, paymentFailed: failedPayment });
}

// ---------------------------------------------------------------------------
// Configuration Netlify : planification CRON
// ---------------------------------------------------------------------------

export const config: Config = {
  /** Chaque jour à 18h00 UTC (= 19h00 hiver / 20h00 été Paris) */
  // ⚠️ NE PAS remplacer par la const SCHEDULE ci-dessus — l'extracteur statique
  // de Netlify (@netlify/zip-it-and-ship-it, parsePrimitive) ne résout QUE les
  // littéraux (StringLiteral), pas les Identifier. `schedule: SCHEDULE` produit
  // `schedule: null` côté Netlify → le scheduler ne déclenche plus (regression
  // #113 introduite par #75). Le littéral DOIT rester inline ici ; le dupliquer
  // avec SCHEDULE est volontaire (DRY brisée par contrainte du bundler).
  schedule: '0 18 * * *',
  // No schedule_timezone → Netlify defaults to UTC (matches Sentry monitor default).
  // Do not add Europe/Paris here — SCHEDULE is calibrated for UTC.
};
