import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Appointment, AppointmentStatus } from '../../types/appointment';
import { getModeLabel } from '../../utils/pricing';
import { STATUS_LABELS } from '../../utils/domain';
import { formatParisShortDateTime } from '../../utils/datetime';
import {
  isUpcomingAppointment,
  paginateAppointments,
  WORKSPACE_PAGE_SIZE,
} from './admin-workspace-utils';

interface AppointmentsManagerProps {
  appointments: Appointment[];
  selectedId: string | null;
  onSelectAppointment: (appointment: Appointment) => void;
}

type AppointmentPeriod = 'upcoming' | 'past';
type FilterKey = 'all' | AppointmentStatus;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'En attente' },
  { key: 'rescheduled', label: 'Reportés' },
  { key: 'payment_pending', label: 'Paiement en attente' },
  { key: 'payment_received', label: 'Réglés' },
  { key: 'confirmed', label: 'Confirmés' },
  { key: 'declined', label: 'Refusés' },
  { key: 'cancelled', label: 'Annulés' },
];

function matchesSearch(appointment: Appointment, query: string): boolean {
  return [
    appointment.patient_name,
    appointment.patient_email,
    appointment.patient_phone,
    appointment.patient_reason,
  ]
    .join(' ')
    .toLocaleLowerCase('fr-FR')
    .includes(query.toLocaleLowerCase('fr-FR'));
}

export function AppointmentsManager({
  appointments,
  selectedId,
  onSelectAppointment,
}: AppointmentsManagerProps) {
  const [period, setPeriod] = useState<AppointmentPeriod>('upcoming');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query.trim());

  const filtered = useMemo(() => {
    const now = new Date();
    return appointments
      .filter(appointment =>
        period === 'upcoming'
          ? isUpcomingAppointment(appointment, now)
          : !isUpcomingAppointment(appointment, now),
      )
      .filter(appointment => filter === 'all' || appointment.status === filter)
      .filter(
        appointment =>
          !deferredQuery || matchesSearch(appointment, deferredQuery),
      )
      .sort((left, right) =>
        period === 'upcoming'
          ? left.scheduled_at.localeCompare(right.scheduled_at)
          : right.scheduled_at.localeCompare(left.scheduled_at),
      );
  }, [appointments, deferredQuery, filter, period]);

  const paginated = useMemo(
    () => paginateAppointments(filtered, page),
    [filtered, page],
  );

  useEffect(() => setPage(0), [period, filter, deferredQuery]);
  useEffect(
    () => setPage(current => Math.min(current, paginated.pageCount - 1)),
    [paginated.pageCount],
  );

  return (
    <section className="space-y-4" aria-labelledby="appointments-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="appointments-title"
            className="font-serif text-2xl font-semibold text-sage-900"
          >
            Rendez-vous
          </h2>
          <p className="mt-1 text-sm text-sage-600">
            {filtered.length} résultat{filtered.length > 1 ? 's' : ''} ·
            affichage par lots de {WORKSPACE_PAGE_SIZE}
          </p>
        </div>
        <div
          className="inline-flex rounded-xl border border-sage-200 bg-white p-1"
          role="group"
          aria-label="Période des rendez-vous"
        >
          <button
            type="button"
            onClick={() => setPeriod('upcoming')}
            aria-pressed={period === 'upcoming'}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${period === 'upcoming' ? 'bg-mint-700 text-white' : 'text-sage-700 hover:bg-sage-50'}`}
          >
            À venir
          </button>
          <button
            type="button"
            onClick={() => setPeriod('past')}
            aria-pressed={period === 'past'}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium ${period === 'past' ? 'bg-mint-700 text-white' : 'text-sage-700 hover:bg-sage-50'}`}
          >
            Historique
          </button>
        </div>
      </div>

      <label className="block">
        <span className="sr-only">Rechercher un rendez-vous</span>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Rechercher nom, email, téléphone ou motif…"
          className="min-h-11 w-full rounded-xl border border-sage-200 bg-white px-3 text-sm text-sage-900 placeholder:text-sage-400 focus:outline-none focus:ring-2 focus:ring-mint-400"
        />
      </label>

      <div className="flex flex-wrap gap-2" aria-label="Filtrer par statut">
        {FILTERS.map(option => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${filter === option.key ? 'border-mint-700 bg-mint-700 text-white' : 'border-sage-200 bg-white text-sage-700 hover:bg-sage-50'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-sage-200 bg-white">
        <ul
          className="divide-y divide-sage-100"
          aria-label="Liste compacte des rendez-vous"
        >
          {paginated.items.map(appointment => (
            <li key={appointment.id}>
              <button
                type="button"
                onClick={() => onSelectAppointment(appointment)}
                aria-pressed={selectedId === appointment.id}
                className={`grid min-h-14 w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-mint-400 sm:grid-cols-[8rem_minmax(0,1fr)_7rem_5rem] ${selectedId === appointment.id ? 'bg-mint-50' : 'hover:bg-sage-50'}`}
              >
                <span className="text-xs font-medium text-sage-700">
                  {formatParisShortDateTime(appointment.scheduled_at)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-sage-900">
                    {appointment.patient_name}
                  </span>
                  <span className="block truncate text-xs text-sage-500">
                    {getModeLabel(appointment.appointment_mode)} ·{' '}
                    {appointment.duration} min
                  </span>
                </span>
                <span className="hidden text-xs text-sage-600 sm:block">
                  {STATUS_LABELS[appointment.status]}
                </span>
                <span className="text-xs text-sage-600">Détail</span>
              </button>
            </li>
          ))}
        </ul>
        {paginated.items.length === 0 && (
          <p className="p-5 text-sm text-sage-600">
            Aucun rendez-vous ne correspond à cette recherche.
          </p>
        )}
      </div>

      <nav
        className="flex items-center justify-between gap-3"
        aria-label="Pagination des rendez-vous"
      >
        <button
          type="button"
          disabled={paginated.page === 0}
          onClick={() => setPage(current => current - 1)}
          className="min-h-11 rounded-xl border border-sage-200 px-3 text-sm text-sage-700 disabled:opacity-50"
        >
          Précédent
        </button>
        <span className="text-sm text-sage-600">
          Page {paginated.page + 1} sur {paginated.pageCount}
        </span>
        <button
          type="button"
          disabled={paginated.page >= paginated.pageCount - 1}
          onClick={() => setPage(current => current + 1)}
          className="min-h-11 rounded-xl border border-sage-200 px-3 text-sm text-sage-700 disabled:opacity-50"
        >
          Suivant
        </button>
      </nav>
    </section>
  );
}
