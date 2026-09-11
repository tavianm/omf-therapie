/**
 * PatientsView — section « Patients » du poste de travail (proposition B,
 * issue #148). Fidèle aux écrans Figma « Patients iPad » / « Fiche Détail
 * Patient iPhone » :
 *
 *  - annuaire dérivé des rendez-vous (`aggregatePatients`, miroir du calcul
 *    de GET /api/admin/patients/) : recherche, alpha-jump, actifs/inactifs
 *  - dossier patient (split-view ≥ lg, bottom sheet < lg) : identité,
 *    contact, métriques dérivées, historique des séances, création de RDV
 *    pré-remplie via le tiroir
 *
 * Les blocs « note clinique », export et création de fiche patient
 * n'existent pas côté backend : rendus désactivés avec la référence de
 * l'issue de suivi (#142, #143) — jamais simulés.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { Appointment } from '../../../../types/appointment';
import type { PrefillData } from '../../../../types/patient';
import { getTypeLabel, getModeLabel } from '../../../../lib/pricing';
import { formatTimeParis, isUpcoming } from '../../../../utils/date';
import { aggregatePatients, type PatientAggregate } from '../../../../utils/workbench';
import { Avatar, ModalOverlay, Prochainement, StatusChip } from '../ui';

interface PatientsViewProps {
  appointments: Appointment[];
  onPlanAppointment: (prefill: PrefillData) => void;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(/\.00$/, '')} €`;
}

function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

export function PatientsView({ appointments, onPlanAppointment }: PatientsViewProps) {
  const [query, setQuery] = useState('');
  const [letter, setLetter] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const nowMs = useMemo(() => Date.now(), []);
  const allPatients = useMemo(() => aggregatePatients(appointments, nowMs), [appointments, nowMs]);

  const activeCount = allPatients.filter((p) => p.isActive).length;
  const inactiveCount = allPatients.length - activeCount;

  // Filtre de base : recherche + actifs/inactifs (SANS la lettre) — les
  // lettres disponibles doivent rester visibles quand une lettre est
  // sélectionnée, sinon on ne peut plus changer de lettre (revue #148).
  const basePatients = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    return allPatients.filter((p) => {
      if (!includeInactive && !p.isActive) return false;
      if (!q) return true;
      return [p.name, p.email, p.phone, p.city, p.postalCode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [allPatients, deferredQuery, includeInactive]);

  const availableLetters = useMemo(
    () => new Set(basePatients.map((p) => p.name[0]?.toUpperCase() ?? '')),
    [basePatients],
  );

  const visiblePatients = useMemo(
    () =>
      letter
        ? basePatients.filter((p) => p.name.toUpperCase().startsWith(letter))
        : basePatients,
    [basePatients, letter],
  );

  const selected =
    (selectedEmail && allPatients.find((p) => p.email === selectedEmail)) || null;

  function handlePlan() {
    if (!selected) return;
    onPlanAppointment({
      patient_name: selected.name,
      patient_email: selected.email,
      patient_phone: selected.phone,
      appointment_type: selected.lastType,
    });
  }

  const dossier = selected && (
    <Dossier
      key={selected.email}
      patient={selected}
      onClose={() => setSelectedEmail(null)}
      onPlan={handlePlan}
    />
  );

  return (
    <div>
      {/* ── En-tête de section ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold font-sans uppercase tracking-wider text-sage-500">
            Poste de consultation
            <span aria-hidden="true">/</span>
            Patients
          </p>
          <h1 className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900 mt-1">
            Patients
          </h1>
          <p className="text-sm text-sage-500 font-sans mt-1">
            Dossiers Patients · {activeCount} actif{activeCount > 1 ? 's' : ''}
            {inactiveCount > 0 ? ` · ${inactiveCount} archivé${inactiveCount > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 text-sm text-sage-700 font-sans min-h-[40px]">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded border-sage-300 text-mint-600 focus:ring-mint-400"
            />
            Inclure les inactifs
          </label>
          <button
            type="button"
            disabled
            title="Export de la patientèle — à construire (#143)"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-200 text-sage-400 cursor-not-allowed min-h-[40px]"
          >
            Exporter
          </button>
          <button
            type="button"
            disabled
            title="Fiche patient autonome — à construire (#143)"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold font-sans rounded-xl bg-sage-900/60 text-white cursor-not-allowed min-h-[40px]"
          >
            + Nouveau patient
          </button>
        </div>
      </div>

      {/* ── Recherche + alpha-jump ────────────────────────────────────────── */}
      <div className="mt-5 space-y-3">
        <div className="relative">
          <label htmlFor="wb-patients-search" className="sr-only">
            Rechercher un patient
          </label>
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sage-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            id="wb-patients-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un patient par nom, email, téléphone, ville…"
            className="
              w-full pl-10 pr-4 py-2.5 text-sm text-sage-900 placeholder-sage-400 font-sans
              border border-sage-200 rounded-xl bg-white
              focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent
              transition-colors min-h-[44px]
            "
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filtrer par initiale">
          <button
            type="button"
            onClick={() => setLetter(null)}
            aria-pressed={letter === null}
            className={`
              shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold font-sans
              transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400
              ${letter === null ? 'bg-sage-900 text-white' : 'bg-white text-sage-600 border border-sage-200 hover:border-mint-400'}
            `}
          >
            Tous
          </button>
          {ALPHABET.map((l) =>
            availableLetters.has(l) ? (
              <button
                key={l}
                type="button"
                onClick={() => setLetter(letter === l ? null : l)}
                aria-pressed={letter === l}
                className={`
                  shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold font-sans
                  transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400
                  ${letter === l ? 'bg-sage-900 text-white' : 'bg-white text-sage-600 border border-sage-200 hover:border-mint-400'}
                `}
              >
                {l}
              </button>
            ) : null,
          )}
        </div>
      </div>

      {/* ── Split view : annuaire + dossier ───────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2.5 px-0.5">
            <h2 className="font-serif text-base font-semibold text-sage-800">Patientèle enregistrée</h2>
            <span className="text-xs font-sans text-sage-500">
              {visiblePatients.length} patient{visiblePatients.length > 1 ? 's' : ''}
            </span>
          </div>
          {visiblePatients.length === 0 ? (
            <p className="rounded-2xl border border-sage-200 bg-white px-5 py-8 text-center text-sm text-sage-500 font-sans">
              Aucun patient trouvé pour ce filtre.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {visiblePatients.map((patient) => {
                const isSelected = selected?.email === patient.email;
                const nextLabel = patient.nextAppointment
                  ? `Prochain rdv : ${formatDateShort(patient.nextAppointment.scheduled_at)}`
                  : `Dernier RDV : ${formatDateShort(patient.lastAppointmentAt)}`;
                return (
                  <li key={patient.email}>
                    <button
                      type="button"
                      onClick={() => setSelectedEmail(isSelected ? null : patient.email)}
                      aria-pressed={isSelected}
                      aria-label={`Ouvrir le dossier de ${patient.name}`}
                      className={`
                        w-full flex items-center gap-3 px-4 py-3 text-left rounded-2xl border bg-white
                        shadow-sm transition-colors hover:border-mint-300
                        focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[64px]
                        ${isSelected ? 'border-l-4 border-l-sage-900 border-sage-200' : 'border-sage-200'}
                      `}
                    >
                      <Avatar name={patient.name} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-serif text-base font-semibold text-sage-900 truncate">
                            {patient.name}
                          </span>
                          <span className="text-xs font-sans text-sage-500 shrink-0">
                            {patient.sessionCount} séance{patient.sessionCount > 1 ? 's' : ''}
                          </span>
                        </span>
                        <span className="block text-xs text-sage-500 font-sans mt-0.5 truncate">
                          {patient.email} · {nextLabel}
                        </span>
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${patient.isActive ? 'bg-mint-500' : 'bg-sage-300'}`}
                        aria-hidden="true"
                      />
                      <span className="hidden sm:inline-flex items-center gap-1 text-sm font-medium font-sans text-sage-600 shrink-0">
                        Dossier
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Dossier — panneau permanent ≥ lg */}
        <aside className="hidden lg:block lg:sticky lg:top-6 min-w-0" aria-label="Dossier du patient sélectionné">
          <div className="rounded-2xl border border-sage-200 bg-white p-5 shadow-sm">
            {selected ? (
              dossier
            ) : (
              <p className="py-10 text-center text-sm text-sage-500 font-sans">
                Sélectionnez un patient pour afficher son dossier.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Dossier — bottom sheet < lg */}
      {selected && (
        <ModalOverlay
          label={`Dossier de ${selected.name}`}
          onClose={() => setSelectedEmail(null)}
          panelClassName="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white shadow-xl max-h-[92dvh] overflow-y-auto px-4 pb-8 pt-3"
        >
          <span className="mx-auto mb-3 block h-1.5 w-12 rounded-full bg-sage-200" aria-hidden="true" />
          {dossier}
        </ModalOverlay>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dossier patient (panneau / sheet)
// ---------------------------------------------------------------------------

interface DossierProps {
  patient: PatientAggregate;
  onClose: () => void;
  onPlan: () => void;
}

function Dossier({ patient, onClose, onPlan }: DossierProps) {
  return (
    <article className="flex flex-col" aria-label={`Dossier de ${patient.name}`}>
      {/* Identité */}
      <header className="flex items-start gap-3">
        <Avatar name={patient.name} className="w-14 h-14 text-base" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-xl font-semibold text-sage-900 truncate">{patient.name}</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-100 px-2.5 py-0.5 text-xs font-medium font-sans text-mint-900">
              <span className={`w-1.5 h-1.5 rounded-full ${patient.isActive ? 'bg-mint-500' : 'bg-sage-400'}`} aria-hidden="true" />
              {patient.isActive ? 'Suivi actif' : 'Suivi ancien'}
            </span>
          </div>
          <p className="text-sm text-sage-500 font-sans mt-0.5">
            {getTypeLabel(patient.lastType)} · Première séance le {formatDateLong(patient.firstAppointmentAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le dossier"
          className="
            inline-flex items-center justify-center w-9 h-9 rounded-full text-sage-400
            hover:text-sage-700 hover:bg-sage-100 focus:outline-none focus:ring-2 focus:ring-mint-400
            transition-colors shrink-0
          "
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </header>

      {/* Contact */}
      <div className="mt-4 rounded-xl bg-mint-50 p-4 space-y-2.5">
        {patient.phone && (
          <p className="flex items-center gap-2.5 text-sm font-sans text-sage-900">
            <svg className="w-4 h-4 text-sage-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
            <a href={`tel:${patient.phone}`} className="hover:text-mint-700 transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400 rounded">
              {patient.phone}
            </a>
            <span className="ml-auto text-xs text-sage-500">Mobile principal</span>
          </p>
        )}
        <p className="flex items-center gap-2.5 text-sm font-sans text-sage-900">
          <svg className="w-4 h-4 text-sage-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
            <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
          </svg>
          <a href={`mailto:${patient.email}`} className="hover:text-mint-700 transition-colors break-all focus:outline-none focus:ring-2 focus:ring-mint-400 rounded">
            {patient.email}
          </a>
          <span className="ml-auto shrink-0 text-xs text-sage-500">Courriel</span>
        </p>
        {(patient.city || patient.postalCode) && (
          <p className="flex items-center gap-2.5 text-sm font-sans text-sage-900">
            <svg className="w-4 h-4 text-sage-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            {[patient.postalCode, patient.city].filter(Boolean).join(' ')}
          </p>
        )}
      </div>

      {/* Métriques */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-mint-50 px-4 py-3">
          <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-500">Séances</p>
          <p className="mt-1 font-serif text-lg font-semibold text-sage-900">
            {patient.completedCount} <span className="font-sans text-xs font-normal text-sage-500">réalisée{patient.completedCount > 1 ? 's' : ''}</span>
          </p>
        </div>
        <div className="rounded-xl bg-mint-50 px-4 py-3">
          <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-500">Solde</p>
          <p className="mt-1 font-serif text-lg font-semibold text-sage-900">
            {patient.pendingPaymentCents > 0 ? (
              <>
                {euros(patient.pendingPaymentCents)}{' '}
                <span className="font-sans text-xs font-normal text-amber-700">en attente</span>
              </>
            ) : patient.paidCents > 0 ? (
              <>
                {euros(patient.paidCents)}{' '}
                <span className="font-sans text-xs font-normal text-sage-500">à jour</span>
              </>
            ) : (
              <span className="font-sans text-xs font-normal text-sage-500">Aucun règlement enregistré</span>
            )}
          </p>
        </div>
      </div>

      {/* Note clinique — à construire (#142) */}
      <div className="mt-3 rounded-xl border border-dashed border-sage-300 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm font-sans text-sage-500">Notes cliniques confidentielles</p>
        <Prochainement issue={142} />
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={onPlan}
        className="
          mt-4 w-full inline-flex flex-col items-center justify-center px-4 py-3 rounded-xl
          bg-sage-900 text-white hover:bg-sage-800 focus:outline-none focus:ring-2
          focus:ring-mint-400 focus:ring-offset-1 transition-colors min-h-[56px]
        "
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold font-sans">
          Planifier un rendez-vous
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </span>
        <span className="text-xs font-sans text-sage-300 mt-0.5">
          Ouvre le formulaire pré-rempli pour {patient.name.split(' ')[0]}
        </span>
      </button>
      <a
        href={`mailto:${patient.email}`}
        className="
          mt-2.5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
          font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50
          focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors min-h-[44px]
        "
      >
        Envoyer un email
      </a>

      {/* Historique */}
      <section className="mt-5" aria-label="Historique des séances">
        <h3 className="text-sm font-semibold font-sans text-sage-800 mb-2.5">
          Historique des séances ({patient.history.length})
        </h3>
        <ul className="space-y-2">
          {patient.history.map((appointment) => {
            const date = new Date(appointment.scheduled_at);
            const isNext =
              patient.nextAppointment?.id === appointment.id && isUpcoming(appointment.scheduled_at);
            return (
              <li key={appointment.id} className="flex items-center gap-3 rounded-xl border border-sage-200 bg-white px-3 py-2.5">
                <span className="inline-flex flex-col items-center justify-center rounded-lg bg-sage-900 text-white px-2.5 py-1 shrink-0">
                  <span className="font-sans text-[10px] uppercase tracking-wide text-sage-300 leading-tight">
                    {new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'Europe/Paris' }).format(date).replace('.', '')}
                  </span>
                  <span className="font-sans text-sm font-semibold leading-tight tabular-nums">
                    {new Intl.DateTimeFormat('fr-FR', { day: '2-digit', timeZone: 'Europe/Paris' }).format(date)}
                  </span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium font-sans text-sage-900 truncate">
                    {isNext ? 'Prochaine séance' : 'Séance'} · {getTypeLabel(appointment.appointment_type)}
                  </span>
                  <span className="block text-xs text-sage-500 font-sans truncate">
                    {formatTimeParis(appointment.scheduled_at)} · {appointment.duration} min · {getModeLabel(appointment.appointment_mode)}
                  </span>
                </span>
                <span className="text-sm font-sans text-sage-700 shrink-0 tabular-nums">
                  {euros(appointment.final_price)}
                </span>
                <StatusChip status={appointment.status} />
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}
