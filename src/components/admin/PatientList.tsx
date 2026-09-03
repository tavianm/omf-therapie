import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Patient } from '../../types/patient';
import { STATUS_LABELS } from '../../utils/domain';
import { formatParisMediumDate } from '../../utils/datetime';
import { paginateAppointments } from './admin-workspace-utils';

interface PatientListProps {
  onStartAppointment: (patient: Patient) => void;
}

function matches(patient: Patient, query: string): boolean {
  return `${patient.name} ${patient.email} ${patient.phone}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR')
    .includes(
      query
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('fr-FR'),
    );
}

export function PatientList({ onStartAppointment }: PatientListProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim());

  // Stale-response guard instead of an AbortController: aborting a monitored
  // fetch makes some Chromium/WebKit versions log an "Uncaught (in promise)
  // AbortError" pointing at the abort() call site even though the rejection
  // is handled. Skipping state updates once the effect re-runs keeps the
  // same race safety without ever creating that DOMException.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/patients/?includeArchived=${String(includeArchived)}`, {
      credentials: 'same-origin',
    })
      .then(async response => {
        if (!response.ok)
          throw new Error(
            ((await response.json()) as { error?: string }).error ??
              'Chargement impossible',
          );
        return response.json() as Promise<{ patients?: Patient[] }>;
      })
      .then(data => {
        if (!cancelled) setPatients(data.patients ?? []);
      })
      .catch(reason => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : 'Erreur inconnue',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived]);

  const filtered = useMemo(
    () =>
      patients.filter(
        patient => !deferredQuery || matches(patient, deferredQuery),
      ),
    [deferredQuery, patients],
  );
  const selected =
    filtered.find(patient => patient.email === selectedEmail) ?? null;
  const history = selected
    ? paginateAppointments(selected.appointments, 0, 10).items
    : [];

  return (
    <section className="space-y-4" aria-labelledby="patients-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="patients-title"
            className="font-serif text-2xl font-semibold text-sage-900"
          >
            Patients
          </h2>
          <p className="mt-1 text-sm text-sage-600">
            {filtered.length} patient{filtered.length > 1 ? 's' : ''}
          </p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-sage-700">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={event => setIncludeArchived(event.target.checked)}
          />{' '}
          Inclure les inactifs
        </label>
      </div>
      <label className="block">
        <span className="sr-only">Rechercher un patient</span>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Nom, email ou téléphone…"
          className="min-h-11 w-full rounded-xl border border-sage-200 px-3 focus:outline-none focus:ring-2 focus:ring-mint-400"
        />
      </label>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <ul className="divide-y divide-sage-100 overflow-hidden rounded-2xl border border-sage-200 bg-white">
          {filtered.map(patient => (
            <li key={patient.email}>
              <button
                type="button"
                onClick={() => setSelectedEmail(patient.email)}
                aria-pressed={selectedEmail === patient.email}
                className={`grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 text-left hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-mint-400 ${selectedEmail === patient.email ? 'bg-mint-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-sage-900">
                    {patient.name}
                  </span>
                  <span className="block truncate text-xs text-sage-500">
                    {patient.email} · {patient.phone || 'sans téléphone'}
                  </span>
                </span>
                <span className="text-xs text-sage-600">
                  {patient.sessionCount} séances
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected && (
          <aside className="rounded-2xl border border-sage-200 bg-white p-4">
            <h3 className="font-serif text-xl font-semibold text-sage-900">
              {selected.name}
            </h3>
            <p className="mt-1 text-sm text-sage-600">
              {selected.email}
              <br />
              {selected.phone || 'Téléphone non renseigné'}
            </p>
            <button
              type="button"
              onClick={() => onStartAppointment(selected)}
              className="mt-4 min-h-11 w-full rounded-xl bg-mint-700 px-3 text-sm font-semibold text-white"
            >
              Nouveau rendez-vous
            </button>
            <h4 className="mt-5 text-sm font-semibold text-sage-900">
              Historique récent
            </h4>
            <ul className="mt-2 space-y-2">
              {history.map(appointment => (
                <li
                  key={appointment.id}
                  className="rounded-xl bg-sage-50 p-2 text-xs text-sage-700"
                >
                  {formatParisMediumDate(appointment.scheduledAt)} ·{' '}
                  {appointment.duration} min ·{' '}
                  {STATUS_LABELS[appointment.status] ?? appointment.status}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}
