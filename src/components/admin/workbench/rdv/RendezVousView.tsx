/**
 * RendezVousView — section « Rendez-vous » du poste de travail (proposition B,
 * issue #148). Reconstruite fidèlement à l'écran Figma « Rendez-vous iPad » :
 *
 *  - bascule segmentée À venir / Historique (au lieu des sections empilées)
 *  - recherche instantanée + pastilles de statut fusionnées (Annulés / Refusés,
 *    Réglés = payment_received), compteurs reflétant la recherche
 *  - groupes par jour Paris avec libellé relatif et compteur de séances
 *  - pagination « Page N sur M »
 *  - filtre « Demandes de RDV » (#164) : appartenance à la file
 *    getDemandItems — partition-agnostique (bascule masquée, groupes de
 *    jours fusionnés), déclenché par la carte KPI de la Synthèse
 *  - ≥ lg : split-view avec fiche détail permanente à droite ;
 *    < lg : la fiche s'ouvre en bottom sheet
 *
 * Les actions de la fiche utilisent le contrat PATCH existant (voir
 * AppointmentDetail). Aucune donnée supplémentaire : la liste vient du SSR.
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment } from '../../../../types/appointment';
import {
  formatDayHeader,
  formatTimeParis,
  getRelativeDayLabel,
  isUpcoming,
  toParisDateString,
} from '../../../../utils/date';
import { getDemandItems } from '../../../../utils/workbench';
import type { WorkbenchRequest } from '../Workbench';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentRow, ModalOverlay } from '../ui';

interface RendezVousViewProps {
  appointments: Appointment[];
  /** Requête venue de la Synthèse : focus d'une ligne ou filtre « Demandes
   * de RDV » (nonce monotone pour ne traiter chaque demande qu'une fois). */
  focus: WorkbenchRequest | null;
  /**
   * Explicit data refetch after a successful mutation (#165) — forwarded to
   * the appointment detail (consumed in place of the former full-page reload).
   */
  onRefresh?: () => void;
}

type Partition = 'upcoming' | 'history';
type FilterKey =
  | 'all'
  | 'demandes'
  | 'pending'
  | 'rescheduled'
  | 'payment_pending'
  | 'payment_received'
  | 'confirmed'
  | 'cancelled_refused';

interface DayGroup {
  dayKey: string;
  dateLabel: string;
  relativeLabel: string | null;
  appointments: Appointment[];
}

const PAGE_SIZE = 10;

const FILTERS: { key: FilterKey; label: string; dot?: string }[] = [
  { key: 'all', label: 'Tous' },
  // Pas de pastille de statut : le filtre est une file d'actions, pas une
  // couleur de statut (#164).
  { key: 'demandes', label: 'Demandes de RDV' },
  { key: 'pending', label: 'En attente', dot: 'bg-amber-400' },
  { key: 'rescheduled', label: 'Reportés' },
  { key: 'payment_pending', label: 'Paiement en attente', dot: 'bg-amber-400' },
  { key: 'payment_received', label: 'Réglés' },
  { key: 'confirmed', label: 'Confirmés', dot: 'bg-mint-500' },
  { key: 'cancelled_refused', label: 'Annulés / Refusés' },
];

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

function matchesFilter(
  a: Appointment,
  filter: FilterKey,
  demandIds: ReadonlySet<string>,
): boolean {
  if (filter === 'all') return true;
  // « Demandes de RDV » : appartenance à la file du thérapeute (et non une
  // égalité de statut) — les demandes en retard (partition historique) et
  // les reports expirés restent visibles : la file cliquée est la file
  // affichée (#164, SC3).
  if (filter === 'demandes') return demandIds.has(a.id);
  if (filter === 'cancelled_refused')
    return a.status === 'cancelled' || a.status === 'declined';
  return a.status === filter;
}

function groupByDay(items: Appointment[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const appointment of items) {
    const dayKey = toParisDateString(new Date(appointment.scheduled_at));
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.appointments.push(appointment);
    } else {
      groups.push({
        dayKey,
        dateLabel: formatDayHeader(appointment.scheduled_at),
        relativeLabel: getRelativeDayLabel(appointment.scheduled_at),
        appointments: [appointment],
      });
    }
  }
  return groups;
}

function rowId(id: string): string {
  return `wb-rdv-row-${id}`;
}

export function RendezVousView({ appointments, focus, onRefresh }: RendezVousViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [partition, setPartition] = useState<Partition>('upcoming');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  // Une requête venue de la Synthèse (focus d'une ligne ou filtre « Demandes
  // de RDV ») ne doit être traitée qu'une fois : les changements d'identité
  // d'appointments (après action) ne doivent pas écraser une recherche active.
  // Canal unique : un seul nonce monotone côté Workbench, un seul ref de garde
  // ici — un filtre ne peut pas avaler un focus et inversement (#164).
  const handledRequestNonceRef = useRef<number | null>(null);

  // Requête union discriminée sur la prop `focus` :
  //  - kind 'focus' → réconcilie recherche / filtre / partition / pagination
  //    avec le RDV ciblé — une recherche restée active peut le masquer et
  //    « page 1 » peut le laisser hors écran, scrollIntoView ne trouvant alors
  //    aucune ligne montée (revue #149). La page est recalculée sur
  //    appointments brut : deferredQuery ne suit pas encore la réinitialisation.
  //  - kind 'filter' → présélectionne le filtre « Demandes de RDV », vide la
  //    recherche, repagine à 1 et annule tout focus en attente (#164, SC3).
  useEffect(() => {
    if (!focus || handledRequestNonceRef.current === focus.nonce) return;
    if (focus.kind === 'filter') {
      handledRequestNonceRef.current = focus.nonce;
      setQuery('');
      setFilter('demandes');
      setPage(1);
      setPendingFocusId(null);
      return;
    }
    const target = appointments.find(a => a.id === focus.id);
    if (!target) return;
    handledRequestNonceRef.current = focus.nonce;
    const targetPartition: Partition = isUpcoming(target.scheduled_at)
      ? 'upcoming'
      : 'history';
    setQuery('');
    setFilter('all');
    setPartition(targetPartition);
    setSelectedId(target.id);
    const now = Date.now();
    const partitionList = appointments
      .filter(
        a =>
          (isUpcoming(a.scheduled_at, now) ? 'upcoming' : 'history') ===
          targetPartition,
      )
      .sort((a, b) =>
        targetPartition === 'upcoming'
          ? a.scheduled_at.localeCompare(b.scheduled_at)
          : b.scheduled_at.localeCompare(a.scheduled_at),
      );
    const index = partitionList.findIndex(a => a.id === target.id);
    setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : 1);
    setPendingFocusId(target.id);
  }, [focus, appointments]);

  // SC5 (#165) — an open appointment that vanished from the refreshed payload
  // (soft-delete elsewhere) closes the detail explicitly: the selection is
  // cleared instead of being left dangling. A poll whose data CHANGED keeps
  // the detail open on the same id (keyed by selected.id, local state kept).
  useEffect(() => {
    if (selectedId && !appointments.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [appointments, selectedId]);

  // File « Demandes de RDV » : ids calculés une seule fois par liste — le
  // filtre est une appartenance à la file, pas une égalité de statut (#164).
  const demandIds = useMemo(
    () => new Set(getDemandItems(appointments).map(a => a.id)),
    [appointments],
  );

  const { filtered, searched, statusCounts, upcomingCount, historyCount } =
    useMemo(() => {
      const q = deferredQuery.toLowerCase().trim();
      const searched = q
        ? appointments.filter(a => searchableText(a).includes(q))
        : appointments;
      const now = Date.now();
      const upcoming = searched
        .filter(a => isUpcoming(a.scheduled_at, now))
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      const history = searched
        .filter(a => !isUpcoming(a.scheduled_at, now))
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
      // Les compteurs des pastilles reflètent la partition affichée (recherche
      // appliquée, filtre de statut exclu) — sinon « Confirmés » annonce 7
      // alors que la liste n'en montre que 2 ou 5 (revue #148).
      const partitionList = partition === 'upcoming' ? upcoming : history;
      const counts: Record<string, number> = {
        all: partitionList.length,
        cancelled_refused: 0,
      };
      for (const a of partitionList) {
        counts[a.status] = (counts[a.status] ?? 0) + 1;
        if (a.status === 'cancelled' || a.status === 'declined')
          counts.cancelled_refused += 1;
      }
      // Exception : « Demandes de RDV » est partition-agnostique — son compteur
      // porte sur les deux partitions (recherche appliquée), comme la liste
      // fusionnée qu'il affiche (#164).
      counts.demandes = searched.filter(a => demandIds.has(a.id)).length;
      return {
        filtered: partitionList,
        searched,
        statusCounts: counts,
        upcomingCount: upcoming.length,
        historyCount: history.length,
      };
    }, [appointments, deferredQuery, partition, demandIds]);

  // Vue « Demandes de RDV » : les deux partitions fusionnées en une seule
  // liste chronologique ascendante — groupByDay fusionne les groupes à
  // cheval sur la frontière à venir/historique (#164, SC3). Sinon : liste
  // de la partition courante, inchangée.
  const listBase = useMemo(
    () =>
      filter === 'demandes'
        ? [...searched].sort((a, b) =>
            a.scheduled_at.localeCompare(b.scheduled_at),
          )
        : filtered,
    [filter, searched, filtered],
  );

  const listFiltered = useMemo(
    () => listBase.filter(a => matchesFilter(a, filter, demandIds)),
    [listBase, filter, demandIds],
  );

  const totalPages = Math.max(1, Math.ceil(listFiltered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => listFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [listFiltered, safePage],
  );
  const groups = useMemo(() => groupByDay(paged), [paged]);

  // Scrolle dès que la ligne ciblée est montée : la recherche différée
  // (useDeferredValue) et la pagination peuvent retarder le rendu de plusieurs
  // frames — un double rAF unique peut arriver trop tôt.
  useEffect(() => {
    if (!pendingFocusId) return;
    let innerRaf = 0;
    const outerRaf = window.requestAnimationFrame(() => {
      innerRaf = window.requestAnimationFrame(() => {
        const row = document.getElementById(rowId(pendingFocusId));
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPendingFocusId(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(outerRaf);
      window.cancelAnimationFrame(innerRaf);
    };
  }, [pendingFocusId, paged]);

  const selected = selectedId
    ? (appointments.find(a => a.id === selectedId) ?? null)
    : null;
  const selectedPatient = useMemo(() => {
    if (!selected) return null;
    // Sous-ensemble minimal pour le sous-titre de la fiche (même règle des
    // 3 mois que l'agrégation patients).
    const samePatient = appointments.filter(
      a => a.patient_email === selected.patient_email,
    );
    const lastSeen = Math.max(
      ...samePatient.map(a => Date.parse(a.scheduled_at)),
    );
    return {
      isActive: lastSeen > Date.now() - 90 * 86_400_000,
      sessionCount: samePatient.length,
    };
  }, [selected, appointments]);

  return (
    <div>
      {/* ── En-tête de section ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold font-sans uppercase tracking-wider text-sage-500">
            <span
              className="w-1.5 h-1.5 rounded-full bg-mint-500"
              aria-hidden="true"
            />
            Agenda connecté
          </p>
          <h1 className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900 mt-1">
            Rendez-vous
          </h1>
          <p className="text-sm text-sage-500 font-sans mt-1">
            {appointments.length} résultats · Gestion de l'agenda et des séances
            de consultation
          </p>
        </div>
        {/* Bascule À venir / Historique — masquée par le filtre « Demandes
            de RDV » (partition-agnostique, #164) ; la partition choisie est
            restaurée telle quelle à la sortie du filtre. */}
        {filter !== 'demandes' && (
          <div
            className="inline-flex rounded-full bg-mint-100 p-1"
            role="group"
            aria-label="Période affichée"
          >
            {[
              {
                key: 'upcoming' as Partition,
                label: `À venir (${upcomingCount})`,
              },
              {
                key: 'history' as Partition,
                label: `Historique (${historyCount})`,
              },
            ].map(({ key, label }) => {
              const isActive = partition === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setPartition(key);
                    setPage(1);
                  }}
                  aria-pressed={isActive}
                  className={`
                    px-4 py-2 rounded-full text-sm font-medium font-sans transition-colors
                    focus:outline-none focus:ring-2 focus:ring-mint-400 min-h-[40px]
                    ${isActive ? 'bg-sage-900 text-white shadow-sm' : 'text-sage-600 hover:text-sage-900'}
                  `}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recherche + pastilles ─────────────────────────────────────────── */}
      <div className="mt-5 rounded-2xl border border-sage-200 bg-white p-3 space-y-3 shadow-sm">
        <div className="relative">
          <label htmlFor="wb-rdv-search" className="sr-only">
            Rechercher un rendez-vous
          </label>
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sage-400 pointer-events-none"
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
            id="wb-rdv-search"
            type="search"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Rechercher par nom de patient, email, téléphone ou motif…"
            className="
              w-full pl-10 pr-10 py-2.5 text-sm text-sage-900 placeholder-sage-400 font-sans
              border border-sage-200 rounded-xl bg-white
              focus:outline-none focus:ring-2 focus:ring-mint-400 focus:border-transparent
              transition-colors min-h-[44px]
            "
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Effacer la recherche"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-sage-400 hover:text-sage-700 hover:bg-sage-100 focus:outline-none focus:ring-2 focus:ring-mint-400"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          )}
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filtrer les rendez-vous"
        >
          {FILTERS.map(({ key, label, dot }) => {
            const count = statusCounts[key] ?? 0;
            if (key !== 'all' && count === 0) return null;
            const isActive = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setPage(1);
                }}
                aria-pressed={isActive}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium font-sans
                  rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400
                  ${isActive ? 'bg-sage-900 text-white border-sage-900' : 'bg-white text-sage-600 border-sage-200 hover:border-mint-400 hover:text-mint-700'}
                `}
              >
                {dot && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : dot}`}
                    aria-hidden="true"
                  />
                )}
                {label}
                {key !== 'all' && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-sage-100 text-sage-600'}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Split view : liste + fiche ────────────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="space-y-6 min-w-0">
          {listFiltered.length === 0 ? (
            <p className="rounded-2xl border border-sage-200 bg-white px-5 py-8 text-center text-sm text-sage-500 font-sans">
              {filter === 'demandes'
                ? deferredQuery
                  ? 'Aucune demande ne correspond à cette recherche.'
                  : 'Aucune demande en attente — tout est à jour.'
                : `Aucun rendez-vous ${partition === 'upcoming' ? 'à venir' : 'dans l’historique'}${
                    deferredQuery || filter !== 'all'
                      ? ' pour cette recherche.'
                      : '.'
                  }`}
            </p>
          ) : (
            groups.map(group => (
              <section
                key={group.dayKey}
                aria-label={group.relativeLabel ?? group.dateLabel}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2.5 px-0.5">
                  <h2 className="font-serif text-base font-semibold text-sage-800">
                    {group.relativeLabel ??
                      group.dateLabel.split(' ').slice(0, 1)}
                    {group.relativeLabel && (
                      <span className="ml-2 font-sans text-xs font-normal text-sage-500 normal-case">
                        {group.dateLabel}
                      </span>
                    )}
                  </h2>
                  {!group.relativeLabel && (
                    <span className="text-xs font-sans text-sage-500">
                      {group.dateLabel}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-sans text-sage-500">
                    {group.appointments.length} séance
                    {group.appointments.length > 1 ? 's' : ''}
                  </span>
                </div>
                <ul className="space-y-2.5">
                  {group.appointments.map(appointment => {
                    const isSelected = selectedId === appointment.id;
                    return (
                      <li
                        key={appointment.id}
                        id={rowId(appointment.id)}
                        className="scroll-mt-24"
                      >
                        <AppointmentRow
                          appointment={appointment}
                          selected={isSelected}
                          onClick={() =>
                            setSelectedId(isSelected ? null : appointment.id)
                          }
                          ariaLabel={`Détails : ${appointment.patient_name}, ${formatTimeParis(appointment.scheduled_at)}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {/* Pagination */}
          {listFiltered.length > PAGE_SIZE && (
            <nav
              className="flex items-center justify-between gap-3 rounded-2xl bg-mint-100 px-4 py-3"
              aria-label="Pagination des rendez-vous"
            >
              <button
                type="button"
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
                className="px-3 py-2 text-sm font-medium font-sans rounded-xl text-sage-600 hover:bg-mint-200/60 focus:outline-none focus:ring-2 focus:ring-mint-400 disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
              >
                ‹ Précédent
              </button>
              <p className="text-sm font-sans text-sage-600">
                Page{' '}
                <span className="font-semibold text-sage-900">{safePage}</span>{' '}
                sur {totalPages}
              </p>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
                className="px-3 py-2 text-sm font-medium font-sans rounded-xl text-sage-600 hover:bg-mint-200/60 focus:outline-none focus:ring-2 focus:ring-mint-400 disabled:opacity-40 disabled:cursor-not-allowed min-h-[40px]"
              >
                Suivant ›
              </button>
            </nav>
          )}
        </div>

        {/* Fiche détail — panneau permanent ≥ lg */}
        <aside
          className="hidden lg:block lg:sticky lg:top-6 min-w-0"
          aria-label="Fiche du rendez-vous sélectionné"
        >
          <div className="rounded-2xl border border-sage-200 bg-white p-5 shadow-sm">
            {selected ? (
              <AppointmentDetail
                key={selected.id}
                appointment={selected}
                patient={selectedPatient}
                variant="pane"
                onClose={() => setSelectedId(null)}
                onRefresh={onRefresh}
              />
            ) : (
              <p className="py-10 text-center text-sm text-sage-500 font-sans">
                Sélectionnez un rendez-vous pour afficher sa fiche.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Fiche détail — bottom sheet < lg uniquement : sur iPad/desktop la
          fiche est déjà affichée dans le panneau droit (revue #148). */}
      {selected && (
        <div className="lg:hidden">
          <ModalOverlay
            label={`Détail du rendez-vous de ${selected.patient_name}`}
            onClose={() => setSelectedId(null)}
            panelClassName="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white shadow-xl max-h-[92dvh] overflow-y-auto px-4 pb-8 pt-3"
          >
            <span
              className="mx-auto mb-3 block h-1.5 w-12 rounded-full bg-sage-200"
              aria-hidden="true"
            />
            <AppointmentDetail
              key={selected.id}
              appointment={selected}
              patient={selectedPatient}
              variant="sheet"
              onClose={() => setSelectedId(null)}
              onRefresh={onRefresh}
            />
          </ModalOverlay>
        </div>
      )}
    </div>
  );
}
