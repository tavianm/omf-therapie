/**
 * AppointmentsManager — React island pour la liste des rendez-vous (back-office)
 *
 * Refonte de la vue /mes-rdvs : remplace la pile de ~89 AppointmentCard denses
 * par une liste compacte repliable, avec :
 *   - recherche instantanée (nom / email / téléphone / motif / cp / ville)
 *   - filtres par statut (compteurs dynamiques reflétant la recherche)
 *   - partition À venir (tri ascendant) / Passés (tri descendant, replié)
 *   - regroupement par jour avec libellé relatif (Aujourd'hui / Demain / …)
 *   - dépliage d'une ligne → <AppointmentCard/> réutilisé tel quel
 *
 * L'état "filtre par statut" persiste en sessionStorage (clé `mes-rdvs-filter`),
 * identique au comportement vanilla précédent.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { Appointment, AppointmentStatus } from '../../types/appointment';
import {
  AppointmentCard,
  STATUS_BADGE,
  STATUS_LABELS,
} from './AppointmentCard';
import {
  formatDayHeader,
  formatTimeParis,
  getRelativeDayLabel,
  isUpcoming,
  toParisDateString,
} from '../../utils/date';
import { getModeLabel } from '../../lib/pricing';

// ---------------------------------------------------------------------------
// Types & constantes
// ---------------------------------------------------------------------------

interface AppointmentsManagerProps {
  appointments: Appointment[];
}

type FilterKey = 'all' | AppointmentStatus;

interface DayGroup {
  dayKey: string; // YYYY-MM-DD (Paris)
  label: string; // « Aujourd'hui » ou format long
  appointments: Appointment[];
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'pending', label: 'En attente' },
  { key: 'rescheduled', label: 'Reportés' },
  { key: 'payment_pending', label: 'Paiement en attente' },
  { key: 'payment_received', label: 'Paiement reçu' },
  { key: 'confirmed', label: 'Confirmés' },
  { key: 'declined', label: 'Refusés' },
  { key: 'cancelled', label: 'Annulés' },
];

const FILTER_STORAGE_KEY = 'mes-rdvs-filter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Construit une chaîne searchable normalisée pour un rendez-vous. */
function searchableText(a: Appointment): string {
  return [
    a.patient_name,
    a.patient_email,
    a.patient_phone,
    a.patient_postal_code,
    a.patient_city,
    a.patient_reason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .trim();
}

/**
 * Regroupe une liste d'appointments (déjà triée) par jour calendaire Paris.
 * Conserve l'ordre d'entrée : un tri ascendant produit des groupes ascendants.
 */
function groupByDay(items: Appointment[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const appt of items) {
    const dayKey = toParisDateString(new Date(appt.scheduled_at));
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.appointments.push(appt);
    } else {
      groups.push({
        dayKey,
        label:
          getRelativeDayLabel(appt.scheduled_at) ??
          formatDayHeader(appt.scheduled_at),
        appointments: [appt],
      });
    }
  }
  return groups;
}

function panelId(apptId: string): string {
  return `appt-panel-${apptId}`;
}

function readInitialFilter(): FilterKey {
  if (typeof window === 'undefined') return 'all';
  const saved = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
  return saved && FILTERS.some((f) => f.key === saved) ? (saved as FilterKey) : 'all';
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function AppointmentsManager({ appointments }: AppointmentsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterKey>(readInitialFilter);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const deferredQuery = useDeferredValue(searchQuery);

  // ── 1. Filtrage (recherche + statut) ──────────────────────────────────────
  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    return appointments.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (q && !searchableText(a).includes(q)) return false;
      return true;
    });
  }, [appointments, deferredQuery, statusFilter]);

  // Compteurs dynamiques des filtres (reflètent la recherche en cours).
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: appointments.length };
    const q = deferredQuery.toLowerCase().trim();
    const base = q
      ? appointments.filter((a) => searchableText(a).includes(q))
      : appointments;
    counts.all = base.length;
    for (const a of base) {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
    }
    return counts;
  }, [appointments, deferredQuery]);

  // ── 2. Partition À venir / Passés ─────────────────────────────────────────
  const { upcomingGroups, pastGroups, upcomingCount, pastCount } = useMemo(() => {
    const now = Date.now();
    const upcoming = filtered
      .filter((a) => isUpcoming(a.scheduled_at, now))
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)); // ascendant
    const past = filtered
      .filter((a) => !isUpcoming(a.scheduled_at, now))
      .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)); // descendant
    return {
      upcomingGroups: groupByDay(upcoming),
      pastGroups: groupByDay(past),
      upcomingCount: upcoming.length,
      pastCount: past.length,
    };
  }, [filtered]);

  function handleFilterChange(key: FilterKey) {
    setStatusFilter(key);
    if (key === 'all') {
      window.sessionStorage.removeItem(FILTER_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(FILTER_STORAGE_KEY, key);
    }
  }

  const hasNoResult = filtered.length === 0;
  const isSearching = deferredQuery.trim().length > 0 || statusFilter !== 'all';

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Barre de recherche */}
      <div className="relative">
        <label htmlFor="appt-search" className="sr-only">
          Rechercher un rendez-vous
        </label>
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sage-400 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
          />
        </svg>
        <input
          id="appt-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher nom, email, téléphone…"
          className="
            w-full pl-10 pr-9 py-2.5 text-sm text-sage-900 placeholder-sage-400 font-sans
            border border-sage-200 rounded-xl bg-white
            focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent
            transition-colors min-h-[44px]
          "
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="
              absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center
              rounded-full text-sage-400 hover:text-sage-700 hover:bg-sage-100
              focus:outline-none focus:ring-2 focus:ring-mint-400 transition-colors
            "
            aria-label="Effacer la recherche"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        )}
      </div>

      {/* Filtres par statut */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filtrer par statut"
      >
        {FILTERS.map(({ key, label }) => {
          const count = statusCounts[key] ?? 0;
          if (key !== 'all' && count === 0) return null;
          const isActive = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleFilterChange(key)}
              aria-pressed={isActive}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium font-sans
                rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400
                ${isActive
                  ? 'bg-mint-600 text-white border-mint-600'
                  : 'bg-white text-sage-600 border-sage-200 hover:border-mint-400 hover:text-mint-700'}
              `}
            >
              {label}
              <span
                className={`
                  inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs rounded-full
                  ${isActive ? 'bg-mint-500 text-white' : 'bg-sage-100 text-sage-600'}
                `}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* État vide */}
      {hasNoResult && (
        <div className="text-center py-12">
          <div className="w-14 h-14 mx-auto mb-4 bg-sage-100 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-sage-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
          </div>
          <p className="font-serif text-lg text-sage-600">
            {isSearching ? 'Aucun résultat' : 'Aucun rendez-vous'}
          </p>
          <p className="text-sage-400 text-sm mt-1 font-sans">
            {isSearching
              ? 'Essayez un autre terme ou changez de filtre.'
              : 'Les nouvelles demandes apparaîtront ici.'}
          </p>
        </div>
      )}

      {/* Section À venir */}
      {upcomingCount > 0 && (
        <section aria-label="Rendez-vous à venir">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-base font-semibold text-sage-800">
              À venir
              <span className="ml-2 text-sm font-sans font-normal text-sage-500">
                {upcomingCount} rendez-vous{upcomingCount > 1 ? 's' : ''}
              </span>
            </h2>
          </div>
          <div className="space-y-6">
            {upcomingGroups.map((group) => (
              <DayGroupBlock
                key={group.dayKey}
                group={group}
                expandedId={expandedId}
                onToggle={setExpandedId}
              />
            ))}
          </div>
        </section>
      )}

      {/* Section Passés (repliée par défaut) */}
      {pastCount > 0 && (
        <section aria-label="Rendez-vous passés" className="pt-2">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="
              w-full flex items-center justify-between gap-3 px-4 py-3
              bg-white rounded-xl border border-sage-200 shadow-sm
              hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
              transition-colors text-left
            "
          >
            <span className="flex items-center gap-2.5 font-serif text-base font-semibold text-sage-700">
              <svg
                className={`w-4 h-4 text-sage-400 transition-transform ${showPast ? 'rotate-90' : ''}`}
                viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              Passés
              <span className="text-sm font-sans font-normal text-sage-500">
                {pastCount} rendez-vous{pastCount > 1 ? 's' : ''}
              </span>
            </span>
            <span className="text-xs font-sans text-sage-400">
              {showPast ? 'Masquer' : 'Afficher'}
            </span>
          </button>
          {showPast && (
            <div className="space-y-6 mt-4">
              {pastGroups.map((group) => (
                <DayGroupBlock
                  key={group.dayKey}
                  group={group}
                  expandedId={expandedId}
                  onToggle={setExpandedId}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sous-composant : un groupe par jour (en-tête + lignes compactes)
// ---------------------------------------------------------------------------

interface DayGroupBlockProps {
  group: DayGroup;
  expandedId: string | null;
  onToggle: (id: string | null) => void;
}

function DayGroupBlock({ group, expandedId, onToggle }: DayGroupBlockProps) {
  return (
    <div>
      {/* En-tête de jour (non sticky : sticky dans un conteneur scrollable
          interne serait plus complexe ; on garde un en-tête simple et lisible) */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <h3 className="font-serif text-sm font-semibold text-sage-700 capitalize">
          {group.label}
        </h3>
        <span className="text-xs font-sans text-sage-400">
          {group.appointments.length}
        </span>
        <span className="flex-1 h-px bg-sage-100" aria-hidden="true" />
      </div>

      <ul className="space-y-2">
        {group.appointments.map((appt) => {
          const isOpen = expandedId === appt.id;
          const pid = panelId(appt.id);
          return (
            <li
              key={appt.id}
              className="rounded-xl border border-sage-200 bg-white overflow-hidden"
            >
              {/* Ligne compacte — bouton toggler */}
              <button
                type="button"
                onClick={() => onToggle(isOpen ? null : appt.id)}
                aria-expanded={isOpen}
                aria-controls={pid}
                className="
                  w-full flex items-center gap-3 px-4 py-3 text-left
                  hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400
                  transition-colors min-h-[56px]
                "
              >
                <span className="font-sans text-sm font-medium text-sage-900 w-16 shrink-0 tabular-nums">
                  {formatTimeParis(appt.scheduled_at)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-sage-900 font-sans truncate">
                    {appt.patient_name}
                  </span>
                  <span className="block text-xs text-sage-500 font-sans truncate">
                    {getModeLabel(appt.appointment_mode)}
                    {appt.is_first_session ? ' · 1ère séance' : ''}
                  </span>
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium font-sans shrink-0 ${STATUS_BADGE[appt.status]}`}
                >
                  {STATUS_LABELS[appt.status]}
                </span>
                <svg
                  className={`w-4 h-4 text-sage-400 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                >
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>

              {/* Panneau déplié — AppointmentCard réutilisé tel quel */}
              {isOpen && (
                <div
                  id={pid}
                  className="border-t border-sage-100 p-4 bg-sage-50/50"
                >
                  <AppointmentCard appointment={appt} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
