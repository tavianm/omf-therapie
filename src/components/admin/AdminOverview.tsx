import type { Appointment } from '../../types/appointment';
import { getModeLabel, getTypeLabel } from '../../utils/pricing';
import { STATUS_LABELS } from './AppointmentCard';
import type { WorkspaceSummary } from './admin-workspace-utils';

interface AdminOverviewProps {
  summary: WorkspaceSummary;
  onSelectAppointment: (appointment: Appointment) => void;
}

function formatAppointmentTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

function AppointmentLink({
  appointment,
  onSelect,
}: {
  appointment: Appointment;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="grid w-full grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-xl border border-sage-200 bg-white px-3 py-3 text-left text-sm transition-colors hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400"
    >
      <span className="font-medium text-sage-800">
        {formatAppointmentTime(appointment.scheduled_at)}
      </span>
      <span>
        <span className="block font-medium text-sage-900">
          {appointment.patient_name}
        </span>
        <span className="block text-xs text-sage-500">
          {getTypeLabel(appointment.appointment_type)} ·{' '}
          {getModeLabel(appointment.appointment_mode)}
        </span>
      </span>
      <span className="text-xs text-sage-600">
        {STATUS_LABELS[appointment.status]}
      </span>
    </button>
  );
}

export function AdminOverview({
  summary,
  onSelectAppointment,
}: AdminOverviewProps) {
  return (
    <section className="space-y-5" aria-labelledby="workspace-overview-title">
      <div>
        <h2
          id="workspace-overview-title"
          className="font-serif text-2xl font-semibold text-sage-900"
        >
          Vue opérationnelle
        </h2>
        <p className="mt-1 text-sm text-sage-600">
          Les priorités du cabinet avant l’historique.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
          aria-labelledby="actionable-title"
        >
          <h3
            id="actionable-title"
            className="text-sm font-semibold text-amber-900"
          >
            À traiter · {summary.actionable.length}
          </h3>
          <div className="mt-3 space-y-2">
            {summary.actionable.slice(0, 5).map(appointment => (
              <AppointmentLink
                key={appointment.id}
                appointment={appointment}
                onSelect={() => onSelectAppointment(appointment)}
              />
            ))}
            {summary.actionable.length === 0 && (
              <p className="text-sm text-amber-800">
                Aucune décision en attente.
              </p>
            )}
          </div>
        </section>

        <section
          className="rounded-2xl border border-mint-200 bg-mint-50 p-4"
          aria-labelledby="next-title"
        >
          <h3 id="next-title" className="text-sm font-semibold text-mint-900">
            Prochain rendez-vous
          </h3>
          {summary.next ? (
            <div className="mt-3">
              <AppointmentLink
                appointment={summary.next}
                onSelect={() => onSelectAppointment(summary.next!)}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-mint-900">
              Aucun rendez-vous à venir.
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="today-title">
        <div className="mb-3 flex items-center justify-between">
          <h3
            id="today-title"
            className="font-serif text-xl font-semibold text-sage-900"
          >
            Aujourd’hui
          </h3>
          <span className="text-sm text-sage-500">
            {summary.today.length} rendez-vous
          </span>
        </div>
        <div className="space-y-2">
          {summary.today.map(appointment => (
            <AppointmentLink
              key={appointment.id}
              appointment={appointment}
              onSelect={() => onSelectAppointment(appointment)}
            />
          ))}
          {summary.today.length === 0 && (
            <p className="rounded-xl border border-sage-200 bg-white p-4 text-sm text-sage-600">
              Aucun rendez-vous prévu aujourd’hui.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
