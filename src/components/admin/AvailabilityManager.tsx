import { useEffect, useMemo, useState } from 'react';
import type { ManualTimeSlot, Period } from '../../types/manual-slots';
import {
  SCHEDULING_BUFFER_VALUES,
  type SchedulingBufferMinutes,
} from '../../types/scheduling-settings';
import {
  calendarMonth,
  calendarMonthBounds,
  calendarMonthDays,
  localDateKey,
  shiftCalendarMonth,
  type CalendarMonth,
} from './admin-availability-utils';

const BUFFER_OPTIONS = SCHEDULING_BUFFER_VALUES;

const PERIOD_OPTIONS: { period: Period; label: string }[] = [
  { period: 'morning', label: 'Ajouter matin' },
  { period: 'afternoon', label: 'Ajouter après-midi' },
  { period: 'all_day', label: 'Ajouter journée' },
];

// Tracks which presence mutation is in flight so the acting button can show
// its own pending hint; one mutation at a time (server-side uniqueness).
type PresenceMutation =
  { kind: 'add'; period: Period } | { kind: 'remove'; slotId: string };

export function AvailabilityManager() {
  const [month, setMonth] = useState<CalendarMonth>(() => {
    const now = new Date();
    return calendarMonth(now.getFullYear(), now.getMonth());
  });
  const [slots, setSlots] = useState<ManualTimeSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState(() =>
    localDateKey(new Date()),
  );
  const [buffer, setBuffer] = useState<SchedulingBufferMinutes>(0);
  const [saving, setSaving] = useState(false);
  const [presenceMutation, setPresenceMutation] =
    useState<PresenceMutation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const bounds = useMemo(() => calendarMonthBounds(month), [month]);
  const selectedSlots = slots.filter(slot => slot.slot_date === selectedDate);

  // Stale-response guard instead of an AbortController — see PatientList for
  // the rationale (abort() itself triggers the engine's unhandled
  // AbortError console artifact).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/time-slots/?from=${bounds.from}&to=${bounds.to}`, {
      credentials: 'same-origin',
    })
      .then(response =>
        response.ok
          ? (response.json() as Promise<{ slots?: ManualTimeSlot[] }>)
          : Promise.reject(new Error('Chargement impossible')),
      )
      .then(data => {
        if (cancelled) return;
        setSlots(data.slots ?? []);
        setLoadError(null);
      })
      .catch(() => {
        // Keep the load failure distinct from a genuinely empty month.
        if (!cancelled) setLoadError('Impossible de charger les présences.');
      });
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  useEffect(() => {
    fetch('/api/admin/scheduling-settings/', { credentials: 'same-origin' })
      .then(response =>
        response.ok
          ? (response.json() as Promise<{
              settings?: { bufferMinutes?: SchedulingBufferMinutes };
            }>)
          : Promise.reject(new Error('Chargement impossible')),
      )
      .then(data => {
        if (data?.settings?.bufferMinutes !== undefined)
          setBuffer(data.settings.bufferMinutes);
      })
      .catch(() =>
        setLoadError('Impossible de charger la marge entre les séances.'),
      );
  }, []);

  async function addPresence(period: Period) {
    if (presenceMutation) return;
    setPresenceMutation({ kind: 'add', period });
    setMessage(null);
    try {
      const response = await fetch('/api/admin/time-slots/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slot_date: selectedDate, period }),
      });
      const data = (await response.json()) as
        ManualTimeSlot | { error?: string };
      if (!response.ok) {
        setMessage(
          'error' in data
            ? (data.error ?? 'Présence refusée.')
            : 'Présence refusée.',
        );
        return;
      }
      setSlots(current => [...current, data as ManualTimeSlot]);
      setMessage('Présence enregistrée. Les créneaux sont mis à jour.');
    } catch {
      setMessage('Impossible d’enregistrer cette présence.');
    } finally {
      setPresenceMutation(null);
    }
  }

  async function removePresence(slot: ManualTimeSlot) {
    if (presenceMutation) return;
    setPresenceMutation({ kind: 'remove', slotId: slot.id });
    try {
      const response = await fetch(`/api/admin/time-slots/${slot.id}/`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setMessage('Impossible de retirer cette présence.');
        return;
      }
      setSlots(current => current.filter(item => item.id !== slot.id));
      setMessage('Présence retirée.');
    } catch {
      setMessage('Impossible de retirer cette présence.');
    } finally {
      setPresenceMutation(null);
    }
  }

  async function saveBuffer(value: SchedulingBufferMinutes) {
    const previous = buffer;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/scheduling-settings/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bufferMinutes: value }),
      });
      const data = (await response.json()) as {
        settings?: { bufferMinutes?: SchedulingBufferMinutes };
        error?: string;
      };
      if (!response.ok || data.settings?.bufferMinutes === undefined)
        throw new Error(data.error ?? 'Enregistrement impossible');
      setBuffer(data.settings.bufferMinutes);
      setMessage(
        `Marge de ${data.settings.bufferMinutes} minute${data.settings.bufferMinutes > 1 ? 's' : ''} enregistrée.`,
      );
    } catch (error) {
      setBuffer(previous);
      setMessage(
        error instanceof Error
          ? error.message
          : 'La marge précédente est conservée.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="availability-title">
      <div>
        <h2
          id="availability-title"
          className="font-serif text-2xl font-semibold text-sage-900"
        >
          Disponibilités
        </h2>
        <p className="mt-1 text-sm text-sage-600">
          Les présences ouvrent les rendez-vous au cabinet ; la visio conserve
          les règles de l’agenda externe.
        </p>
      </div>
      {loadError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {loadError}
        </p>
      )}
      {message && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border border-mint-200 bg-mint-50 p-3 text-sm text-mint-900"
        >
          {message}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-sage-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setMonth(current => shiftCalendarMonth(current, -1))
              }
              className="min-h-11 rounded-xl border border-sage-200 px-3 text-sm"
            >
              Mois précédent
            </button>
            <h3 className="font-semibold text-sage-900">
              {new Intl.DateTimeFormat('fr-FR', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(Date.UTC(month.year, month.monthIndex, 1)))}
            </h3>
            <button
              type="button"
              onClick={() =>
                setMonth(current => shiftCalendarMonth(current, 1))
              }
              className="min-h-11 rounded-xl border border-sage-200 px-3 text-sm"
            >
              Mois suivant
            </button>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1">
            {calendarMonthDays(month).map(day => {
              const key = day.key;
              const periods = slots
                .filter(slot => slot.slot_date === key)
                .map(slot => slot.period);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  aria-pressed={selectedDate === key}
                  className={`min-h-11 rounded-lg border p-1 text-left text-xs focus:outline-none focus:ring-2 focus:ring-mint-400 ${selectedDate === key ? 'border-mint-700 bg-mint-50' : 'border-sage-100 hover:bg-sage-50'}`}
                >
                  <span className="block font-medium">{day.day}</span>
                  {periods.length > 0 && (
                    <span className="block text-[10px] text-mint-800">
                      {periods.includes('all_day')
                        ? 'Journée'
                        : periods
                            .join(' + ')
                            .replace('morning', 'Matin')
                            .replace('afternoon', 'Après-midi')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
        <section className="rounded-2xl border border-sage-200 bg-white p-4">
          <h3 className="font-semibold text-sage-900">
            {new Intl.DateTimeFormat('fr-FR', {
              dateStyle: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${selectedDate}T00:00:00Z`))}
          </h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {PERIOD_OPTIONS.map(option => {
              const isAdded = selectedSlots.some(
                slot => slot.period === option.period,
              );
              const isAddingThis =
                presenceMutation?.kind === 'add' &&
                presenceMutation.period === option.period;
              return (
                <button
                  key={option.period}
                  type="button"
                  onClick={() => void addPresence(option.period)}
                  disabled={presenceMutation !== null}
                  aria-pressed={isAdded}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                    isAdded
                      ? 'border-mint-700 bg-mint-700 text-white'
                      : 'border-sage-200 text-sage-700 hover:bg-sage-50'
                  }`}
                >
                  {isAddingThis ? 'Ajout…' : option.label}
                </button>
              );
            })}
          </div>
          <ul className="mt-4 space-y-2">
            {selectedSlots.map(slot => (
              <li
                key={slot.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-sage-50 p-3 text-sm text-sage-700"
              >
                <span>
                  {slot.period === 'all_day'
                    ? 'Journée complète'
                    : slot.period === 'morning'
                      ? 'Matin'
                      : 'Après-midi'}
                </span>
                <button
                  type="button"
                  onClick={() => void removePresence(slot)}
                  disabled={presenceMutation !== null}
                  className="min-h-11 rounded-xl px-3 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {presenceMutation?.kind === 'remove' &&
                  presenceMutation.slotId === slot.id
                    ? 'Suppression…'
                    : 'Retirer'}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-sage-200 pt-4">
            <h3 className="font-semibold text-sage-900">
              Marge entre les séances
            </h3>
            <p className="mt-1 text-sm text-sage-600">
              Elle bloque le départ suivant sans modifier la durée clinique ni
              les invitations.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {BUFFER_OPTIONS.map(value => (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => void saveBuffer(value)}
                  aria-pressed={buffer === value}
                  className={`min-h-11 rounded-xl border px-4 text-sm font-medium disabled:opacity-60 ${buffer === value ? 'border-mint-700 bg-mint-700 text-white' : 'border-sage-200 text-sage-700'}`}
                >
                  {value === 0 ? 'Aucune marge' : `${value} minutes`}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
