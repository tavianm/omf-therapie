/**
 * DisponibilitesView — section « Disponibilités & calendrier » du poste de
 * travail (proposition B, issue #148). Fidèle à l'écran Figma du même nom :
 *
 *  - calendrier mensuel avec pastilles « plage cabinet posée »
 *  - panneau du jour : plages présentiel manuelles (GET/POST/DELETE
 *    /api/admin/time-slots/ — même contrat que <TimeSlotManager/> côté
 *    proposition A) + statut de synchronisation Google Agenda
 *  - marge entre les séances (0/15/20 min) branchée sur
 *    GET/PATCH /api/admin/scheduling-settings/ — portée de la branche
 *    codex/fix-ipad-admin-appointments (politique de planification #133)
 *
 * La fermeture de demi-journées et les blocages motivés restent sans
 * backend : carte rendue désactivée avec la référence #145 — jamais
 * simulée. La mention Doctolib de la maquette n'est pas affichée (pas
 * d'intégration — #147).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ManualTimeSlot, Period } from '../../../../types/manual-slots';
import {
  isSchedulingBufferMinutes,
  type SchedulingBufferMinutes,
  type SchedulingSettings,
} from '../../../../types/scheduling-settings';
import GoogleCalendarStatus from '../../GoogleCalendarStatus';
import { Prochainement } from '../ui';

const PERIOD_LABELS: Record<Period, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  all_day: 'Journée complète',
};

const WEEKDAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

const BUFFER_OPTIONS: { value: SchedulingBufferMinutes; label: string; sub: string }[] = [
  { value: 0, label: 'Aucune', sub: '0 min' },
  { value: 15, label: '15 min', sub: 'Recommandé' },
  { value: 20, label: '20 min', sub: 'Respiration' },
];

const MONTH_FORMAT = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const DAY_LONG_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Lundi-based grid offset (0 = lundi) for a Date, in local time. */
function mondayOffset(date: Date): number {
  return (date.getDay() + 6) % 7;
}

interface DisponibilitesViewProps {
  /** Plages manuelles déjà connues (SSR) — évite un aller-retour au montage. */
  initialSlots?: ManualTimeSlot[];
}

export function DisponibilitesView({ initialSlots }: DisponibilitesViewProps) {
  const today = useMemo(() => new Date(), []);
  const [monthAnchor, setMonthAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => toISODate(today));
  const [slots, setSlots] = useState<ManualTimeSlot[]>(initialSlots ?? []);
  const [loading, setLoading] = useState(!initialSlots);
  const [error, setError] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState<Period>('morning');
  const [submitting, setSubmitting] = useState(false);

  // ── Marge entre les séances (politique de planification) ─────────────────
  const [settings, setSettings] = useState<SchedulingSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [bufferSaving, setBufferSaving] = useState(false);
  const [bufferNotice, setBufferNotice] = useState<string | null>(null);
  const [bufferError, setBufferError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/scheduling-settings/', {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Erreur lors du chargement de la marge');
        }
        const body = (await res.json()) as { settings: SchedulingSettings };
        if (!body.settings || !isSchedulingBufferMinutes(body.settings.bufferMinutes)) {
          throw new Error('Valeur de marge invalide renvoyée par le serveur.');
        }
        setSettings(body.settings);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setBufferError(e instanceof Error ? e.message : 'Erreur inconnue');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettingsLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function updateBuffer(next: SchedulingBufferMinutes) {
    if (!settings || bufferSaving || next === settings.bufferMinutes) return;
    setBufferSaving(true);
    setBufferNotice(null);
    setBufferError(null);
    try {
      const res = await fetch('/api/admin/scheduling-settings/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bufferMinutes: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { settings?: SchedulingSettings; error?: string };
      if (!res.ok || !body.settings) {
        throw new Error(body.error ?? 'Impossible d’enregistrer la marge.');
      }
      setSettings(body.settings);
      setBufferNotice(
        next === 0 ? 'Marge désactivée.' : `Marge de ${next} min appliquée.`,
      );
    } catch (e) {
      setBufferError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setBufferSaving(false);
    }
  }

  // La plage interrogée suit le mois AFFICHÉ : naviguer vers un autre mois
  // doit charger ses plages, sinon elles paraissent inexistantes et une
  // création réussie disparaît du calendrier (revue #148).
  const refetch = useCallback(async (anchor: Date) => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      const res = await fetch(`/api/admin/time-slots/?from=${toISODate(from)}&to=${toISODate(to)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Erreur lors du chargement des plages');
      }
      const body = (await res.json()) as { slots: ManualTimeSlot[] };
      setSlots(body.slots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialSlots) void refetch(monthAnchor);
  }, [initialSlots, refetch, monthAnchor]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, ManualTimeSlot[]>();
    for (const slot of slots) {
      if (slot.deleted_at) continue;
      const list = map.get(slot.slot_date);
      if (list) list.push(slot);
      else map.set(slot.slot_date, [slot]);
    }
    return map;
  }, [slots]);

  const daySlots = slotsByDate.get(selectedDate) ?? [];

  const monthGrid = useMemo(() => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: mondayOffset(first) }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(year, month, day));
    }
    return cells;
  }, [monthAnchor]);

  async function addSlot() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/time-slots/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slot_date: selectedDate, period: newPeriod }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Erreur lors de l’ajout de la plage');
      }
      await refetch(monthAnchor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeSlot(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/time-slots/${id}/`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Erreur lors de la suppression');
      }
      setSlots((current) => current.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  }

  const isToday = (date: Date) => toISODate(date) === toISODate(today);

  return (
    <div>
      {/* ── En-tête de section ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold font-sans uppercase tracking-wider text-sage-500">
            <span className="rounded-full bg-mint-100 px-2 py-0.5">Gestion du planning</span>
            <span className="rounded-full bg-mint-100 px-2 py-0.5 normal-case inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-mint-500" aria-hidden="true" />
              Sync Google Agenda
            </span>
          </p>
          <h1 className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900 mt-1.5">
            Disponibilités &amp; calendrier
          </h1>
          <p className="text-sm text-sage-500 font-sans mt-1 max-w-2xl">
            Les présences ouvrent les rendez-vous au cabinet ; la visio conserve les règles de
            l'agenda synchronisé.
          </p>
        </div>
        <div className="inline-flex rounded-full bg-mint-100 p-1" role="group" aria-label="Vue du planning">
          <span className="px-4 py-2 rounded-full text-sm font-medium font-sans bg-sage-900 text-white shadow-sm min-h-[40px] inline-flex items-center">
            Mois
          </span>
          <span className="px-4 py-2 rounded-full text-sm font-medium font-sans text-sage-400 inline-flex items-center" title="Vue semaine — à construire (#145)">
            Semaine
          </span>
        </div>
      </div>

      {/* ── Deux colonnes ─────────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        {/* Calendrier mensuel */}
        <div className="rounded-2xl border border-sage-200 bg-white p-5 shadow-sm min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-lg font-semibold text-sage-900 capitalize inline-flex items-center gap-2">
              <svg className="w-5 h-5 text-mint-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              {MONTH_FORMAT.format(monthAnchor)}
            </h2>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}
                aria-label="Mois précédent"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-sage-200 text-sage-600 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}
                aria-label="Mois suivant"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-sage-200 text-sage-600 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors"
              >
                ›
              </button>
            </div>
          </div>

          <table className="mt-4 w-full" role="grid" aria-label={`Calendrier ${MONTH_FORMAT.format(monthAnchor)}`}>
            <thead>
              <tr>
                {WEEKDAY_LABELS.map((label) => (
                  <th key={label} scope="col" className="text-[11px] font-semibold font-sans text-sage-400 pb-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.ceil(monthGrid.length / 7) }, (_, week) => (
                <tr key={week}>
                  {monthGrid.slice(week * 7, week * 7 + 7).map((date, dayIdx) => {
                    if (!date) {
                      return <td key={`empty-${dayIdx}`} className="p-0" />;
                    }
                    const iso = toISODate(date);
                    const hasSlot = (slotsByDate.get(iso)?.length ?? 0) > 0;
                    const isSelected = selectedDate === iso;
                    return (
                      <td key={iso} className="p-0 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedDate(iso)}
                          aria-pressed={isSelected}
                          aria-label={`${DAY_LONG_FORMAT.format(date)}${hasSlot ? ' — plage cabinet posée' : ''}`}
                          className={`
                            relative w-10 h-10 mx-auto inline-flex flex-col items-center justify-center
                            rounded-full text-sm font-sans transition-colors
                            focus:outline-none focus:ring-2 focus:ring-mint-400
                            ${isSelected ? 'bg-sage-900 text-white' : isToday(date) ? 'text-mint-700 font-bold hover:bg-mint-50' : 'text-sage-700 hover:bg-mint-50'}
                          `}
                        >
                          {date.getDate()}
                          {hasSlot && (
                            <span
                              className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-mint-300' : 'bg-mint-500'}`}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 flex items-center gap-2 text-xs font-sans text-sage-500">
            <span className="w-2 h-2 rounded-full bg-mint-500" aria-hidden="true" />
            Plage cabinet posée
          </p>
        </div>

        {/* Panneau du jour */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-sage-200 bg-white p-5 shadow-sm">
            <header className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-lg font-semibold text-sage-900 capitalize">
                {DAY_LONG_FORMAT.format(new Date(`${selectedDate}T12:00:00`))}
              </h2>
              <span className="inline-flex items-center rounded-full bg-mint-100 px-2.5 py-0.5 text-xs font-medium font-sans text-mint-900">
                {daySlots.length > 0 ? `${daySlots.length} plage${daySlots.length > 1 ? 's' : ''} posée${daySlots.length > 1 ? 's' : ''}` : 'Aucune plage'}
              </span>
            </header>

            {/* 1. Créneaux en présentiel */}
            <section className="mt-4" aria-label="Créneaux en présentiel">
              <h3 className="text-sm font-semibold font-sans text-sage-800 mb-2.5">
                1. Créneaux en présentiel (cabinet)
              </h3>
              {loading ? (
                <p className="text-sm text-sage-500 font-sans" role="status">Chargement…</p>
              ) : daySlots.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sage-300 px-4 py-3 text-sm text-sage-500 font-sans">
                  Aucune plage ouverte ce jour-là — les rendez-vous visio restent régis par l'agenda
                  synchronisé.
                </p>
              ) : (
                <ul className="space-y-2">
                  {daySlots.map((slot) => (
                    <li
                      key={slot.id}
                      className="flex items-center gap-3 rounded-xl bg-mint-50 border border-mint-100 px-4 py-3"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold font-sans text-sage-900">
                          {PERIOD_LABELS[slot.period]}
                        </span>
                        <span className="block text-xs font-sans text-mint-700">Ouvert aux rendez-vous cabinet</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.id)}
                        className="
                          inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium font-sans
                          rounded-xl border border-sage-300 bg-white text-sage-700 hover:bg-sage-50
                          focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors min-h-[40px]
                        "
                      >
                        × Retirer
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Sur-mesure : ajout d'une plage */}
              <div className="mt-3 rounded-xl border border-dashed border-sage-300 p-3">
                <p className="flex items-center justify-between gap-2 text-sm font-medium font-sans text-sage-700">
                  Sur-mesure
                  <span className="text-xs font-normal text-sage-400">Plage cabinet personnalisée</span>
                </p>
                <fieldset className="mt-2">
                  <legend className="sr-only">Période de la plage à ajouter</legend>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(PERIOD_LABELS) as Period[]).map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setNewPeriod(period)}
                        aria-pressed={newPeriod === period}
                        className={`
                          px-3 py-2 rounded-xl text-sm font-medium font-sans transition-colors
                          focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[40px]
                          ${newPeriod === period ? 'bg-sage-900 text-white' : 'bg-white border border-sage-200 text-sage-600 hover:border-mint-400'}
                        `}
                      >
                        {PERIOD_LABELS[period]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <button
                  type="button"
                  onClick={addSlot}
                  disabled={submitting}
                  className="
                    mt-2.5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
                    font-semibold font-sans rounded-xl border border-sage-300 bg-white text-sage-800
                    hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
                    transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[44px]
                  "
                >
                  ⊕ Ajouter cette plage présentiel
                </button>
              </div>
            </section>

            {/* 2. Blocages — à construire (#145) */}
            <section className="mt-5" aria-label="Indisponibilités et blocages">
              <h3 className="text-sm font-semibold font-sans text-sage-800 mb-2.5">
                2. Indisponibilités &amp; blocages
              </h3>
              <div className="rounded-xl border border-dashed border-sage-300 px-4 py-4 space-y-2">
                <p className="text-sm font-sans text-sage-500">
                  Fermer une demi-journée, poser un blocage motivé (pause, supervision) et définir
                  la marge entre les séances.
                </p>
                <Prochainement issue={145} />
              </div>
            </section>
          </div>

          {/* Marge entre les séances — politique de planification (port #133) */}
          <div className="rounded-2xl border border-sage-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-base font-semibold text-sage-900">Marge entre les séances</h2>
              <span className="inline-flex items-center rounded-full bg-mint-100 px-2.5 py-0.5 text-[10px] font-semibold font-sans uppercase tracking-wide text-mint-900">
                {settingsLoading
                  ? 'Chargement…'
                  : bufferSaving
                    ? 'Enregistrement…'
                    : settings
                      ? `Actif · ${settings.bufferMinutes === 0 ? 'aucune' : `${settings.bufferMinutes} min`}`
                      : 'Indisponible'}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-sage-500 font-sans">
              Délai de transition automatique appliqué entre chaque rendez-vous.
            </p>
            <fieldset disabled={settingsLoading || bufferSaving || !settings} className="mt-3">
              <legend className="sr-only">Marge entre les séances</legend>
              <div className="grid grid-cols-3 gap-2">
                {BUFFER_OPTIONS.map((option) => {
                  const isActive = settings?.bufferMinutes === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => void updateBuffer(option.value)}
                      aria-pressed={isActive}
                      className={`
                        inline-flex flex-col items-center rounded-xl px-2 py-2.5 transition-colors
                        focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[52px]
                        ${isActive ? 'bg-sage-900 text-white' : 'border border-sage-200 bg-white text-sage-600 hover:border-mint-400 hover:text-mint-700'}
                      `}
                    >
                      <span className="text-sm font-medium font-sans">
                        {isActive ? `✓ ${option.label}` : option.label}
                      </span>
                      <span className={`text-[10px] font-sans ${isActive ? 'text-sage-300' : 'text-sage-400'}`}>
                        {option.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <p className="mt-2.5 flex items-start gap-1.5 text-xs text-sage-400 font-sans">
              <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              Bloque l'heure de départ suivant sans impacter la durée clinique affichée au patient.
            </p>
            {bufferNotice && (
              <p role="status" className="mt-2 rounded-xl border border-mint-200 bg-mint-50 px-3 py-2 text-xs font-sans text-mint-800">
                {bufferNotice}
              </p>
            )}
            {bufferError && (
              <p role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-sans text-red-700">
                {bufferError}
              </p>
            )}
          </div>

          {/* Statut Google Agenda (composant réel existant) */}
          <GoogleCalendarStatus />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-sans">
          {error}
        </p>
      )}
    </div>
  );
}
